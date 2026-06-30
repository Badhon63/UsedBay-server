require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 5000;
const app = express();

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send({ message: "UsedBay server running" });
});

const client = new MongoClient(process.env.MONGO_DB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("usedbay");
    const productsCollection = db.collection("products");
    const ordersCollection = db.collection("orders");
    const wishlistCollection = db.collection("wishlist");
    const paymentsCollection = db.collection("payments");
    const usersCollection = db.collection("user"); // Better Auth uses "user" collection

    // ==================== PRODUCTS ====================

    app.post("/api/products", async (req, res) => {
      const data = req.body;
      const result = await productsCollection.insertOne(data);
      res.send(result);
    });

    app.get("/api/products", async (req, res) => {
      const sellerId = req.query.sellerId;
      let query = {};
      if (sellerId) {
        query = { "sellerInfo.userId": sellerId };
      }
      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/api/all-products", async (req, res) => {
      const search = req.query.search || "";
      const sort = req.query.sort || "newest";
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;

      let query = {};
      if (search) {
        query.title = { $regex: search, $options: "i" };
      }

      let sortObj = { _id: -1 };
      if (sort === "priceLow") sortObj = { price: 1 };
      else if (sort === "priceHigh") sortObj = { price: -1 };

      try {
        const total = await productsCollection.countDocuments(query);
        const result = await productsCollection
          .find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          products: result,
          total,
          pages: Math.ceil(total / limit),
          currentPage: page,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/api/products/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await productsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!result) {
          return res.status(404).json({ error: "Product not found" });
        }
        res.send(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.patch("/api/products/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const newData = { $set: req.body };
      const result = await productsCollection.updateOne(query, newData);
      res.send(result);
    });

    app.delete("/api/products/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });

    // ==================== ORDERS ====================

    app.get("/api/orders", async (req, res) => {
      const buyerId = req.query.buyerId;
      const sellerId = req.query.sellerId;

      let query = {};
      if (buyerId) query = { "buyerInfo.userId": buyerId };
      if (sellerId) query = { "sellerInfo.userId": sellerId };

      try {
        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/api/orders/:id", async (req, res) => {
      const { id } = req.params;
      const { orderStatus } = req.body;
      const { ObjectId } = require("mongodb");

      try {
        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { orderStatus } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ==================== SELLER STATS ====================

    app.get("/api/seller/stats", async (req, res) => {
      const sellerId = req.query.sellerId;
      try {
        const totalProducts = await productsCollection.countDocuments({
          "sellerInfo.userId": sellerId,
        });
        const orders = await ordersCollection
          .find({ "sellerInfo.userId": sellerId })
          .toArray();

        const totalOrders = orders.length;
        const totalRevenue = orders
          .filter((o) => o.paymentStatus === "paid")
          .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const pendingOrders = orders.filter(
          (o) => o.orderStatus === "pending",
        ).length;

        const monthly = {};
        orders.forEach((o) => {
          if (o.createdAt) {
            const month = new Date(o.createdAt).toLocaleString("default", {
              month: "short",
            });
            monthly[month] = (monthly[month] || 0) + (o.totalAmount || 0);
          }
        });

        res.send({
          totalProducts,
          totalOrders,
          totalRevenue,
          pendingOrders,
          monthly,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ==================== WISHLIST ====================

    app.post("/api/wishlist", async (req, res) => {
      const { userId, productId } = req.body;
      try {
        const result = await wishlistCollection.insertOne({
          userId,
          productId,
          createdAt: new Date(),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/api/wishlist", async (req, res) => {
      const userId = req.query.userId;
      try {
        const result = await wishlistCollection
          .aggregate([
            { $match: { userId } },
            {
              $lookup: {
                from: "products",
                let: { pid: "$productId" },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ["$_id", { $toObjectId: "$$pid" }] },
                    },
                  },
                ],
                as: "product",
              },
            },
            { $unwind: "$product" },
          ])
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.delete("/api/wishlist/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await wishlistCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ==================== STRIPE PAYMENT ====================

    // Step 1: Create payment intent
    app.post("/api/payment/create-intent", async (req, res) => {
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Step 2: Save order + payment after successful payment
    app.post("/api/payment/confirm", async (req, res) => {
      const {
        transactionId,
        buyerInfo,
        sellerInfo,
        productId,
        productTitle,
        deliveryInfo,
        totalAmount,
      } = req.body;

      try {
        const order = {
          buyerInfo,
          sellerInfo,
          productId,
          productTitle,
          deliveryInfo,
          totalAmount,
          transactionId,
          paymentStatus: "paid",
          orderStatus: "pending",
          createdAt: new Date(),
        };
        const orderResult = await ordersCollection.insertOne(order);

        const payment = {
          orderId: orderResult.insertedId.toString(),
          transactionId,
          buyerId: buyerInfo.userId,
          amount: totalAmount,
          paymentStatus: "success",
          paymentMethod: "card",
          paymentDate: new Date(),
        };
        await paymentsCollection.insertOne(payment);

        res.send({ success: true, orderId: orderResult.insertedId });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get payment history for buyer
    app.get("/api/payments", async (req, res) => {
      const buyerId = req.query.buyerId;
      try {
        const result = await paymentsCollection
          .find({ buyerId })
          .sort({ paymentDate: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ==================== ADMIN ROUTES ====================

    // Get all users
    app.get("/api/admin/users", async (req, res) => {
      try {
        const result = await usersCollection.find({}).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Update user status
    app.patch("/api/admin/users/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Delete user
    app.delete("/api/admin/users/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get all products (admin)
    app.get("/api/admin/products", async (req, res) => {
      try {
        const result = await productsCollection.find({}).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Get all orders (admin)
    app.get("/api/admin/orders", async (req, res) => {
      try {
        const result = await ordersCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/api/payment/create-intent", async (req, res) => {
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // Convert to cents
          currency: "bdt",
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    app.get("/api/payment/history", async (req, res) => {
      try {
        const { userId } = req.query;

        if (!userId) {
          return res.status(400).json({ error: "userId required" });
        }

        const payments = await ordersCollection
          .find({ "buyerInfo.userId": userId })
          .sort({ createdAt: -1 })
          .toArray();

        const formattedPayments = payments.map((order) => ({
          _id: order._id,
          transactionId: order.transactionId || order._id,
          amount: order.totalAmount,
          paymentMethod: "card",
          paymentStatus: order.paymentStatus || "success",
          paymentDate: order.createdAt,
        }));

        res.json(formattedPayments);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/seller-dashboard/:sellerId", async (req, res) => {
      const { sellerId } = req.params;

      try {
        // Total products
        const totalProducts = await productsCollection.countDocuments({
          "sellerInfo.userId": sellerId,
        });

        // Total orders & revenue
        const orders = await ordersCollection
          .find({ "sellerInfo.userId": sellerId })
          .toArray();
        const totalSales = orders.length;
        const totalRevenue = orders.reduce(
          (sum, o) => sum + (o.totalAmount || 0),
          0,
        );
        const pendingOrders = orders.filter(
          (o) => o.orderStatus === "pending",
        ).length;

        // Monthly sales (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const monthlyData = await ordersCollection
          .aggregate([
            {
              $match: {
                "sellerInfo.userId": sellerId,
                createdAt: { $gte: sixMonthsAgo },
              },
            },
            {
              $group: {
                _id: {
                  month: { $month: "$createdAt" },
                  year: { $year: "$createdAt" },
                },
                sales: { $sum: 1 },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
          ])
          .toArray();

        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const chartData = monthlyData.map((m) => ({
          month: monthNames[m._id.month - 1],
          sales: m.sales,
        }));

        // Top selling products
        const topProducts = await ordersCollection
          .aggregate([
            { $match: { "sellerInfo.userId": sellerId } },
            {
              $group: {
                _id: "$productId",
                name: { $first: "$productTitle" },
                sales: { $sum: 1 },
                revenue: { $sum: "$totalAmount" },
              },
            },
            { $sort: { sales: -1 } },
            { $limit: 5 },
          ])
          .toArray();

        const formattedTopProducts = topProducts.map((p) => ({
          id: p._id,
          name: p.name,
          sales: p.sales,
          revenue: `৳${p.revenue.toLocaleString()}`,
        }));

        // Recent products (any 5)
        const recentProducts = await productsCollection
          .find({ "sellerInfo.userId": sellerId })
          .limit(5)
          .toArray();

        const formattedRecentProducts = recentProducts.map((p) => ({
          id: p._id,
          name: p.title,
          price: `৳${p.price.toLocaleString()}`,
          status: p.status,
        }));

        // Recent orders (5)
        const recentOrders = await ordersCollection
          .find({ "sellerInfo.userId": sellerId })
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        const formattedRecentOrders = recentOrders.map((o, idx) => ({
          id: idx + 1,
          orderNum: `ORD-${String(idx + 1).padStart(3, "0")}`,
          buyer: o.buyerInfo.name,
          product: o.productTitle,
          status: o.orderStatus,
          amount: `৳${o.totalAmount.toLocaleString()}`,
        }));

        res.json({
          stats: {
            totalProducts,
            totalSales,
            totalRevenue: `৳${totalRevenue.toLocaleString()}`,
            pendingOrders,
          },
          chartData,
          topProducts: formattedTopProducts,
          recentProducts: formattedRecentProducts,
          recentOrders: formattedRecentOrders,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    console.log("Connected to MongoDB. All routes ready.");
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
