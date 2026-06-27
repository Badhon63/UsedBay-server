require("dotenv").config();
const express = require("express");
const PORT = process.env.PORT;
const app = express();
const cors = require("cors");

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send({ message: "homepage" });
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
      if (sort === "priceLow") {
        sortObj = { price: 1 };
      } else if (sort === "priceHigh") {
        sortObj = { price: -1 };
      }

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

    app.patch("/api/products/:id", async (req, res) => {
      const { id } = req.params;
      const query = {
        _id: new ObjectId(id),
      };
      const newData = {
        $set: req.body,
      };
      const result = await productsCollection.updateOne(query, newData);
      res.send(result);
    });

    app.delete("/api/products/:id", async (req, res) => {
      const { id } = req.params;
      const query = {
        _id: new ObjectId(id),
      };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/api/products/:id", async (req, res) => {
      const { id } = req.params;
      const { ObjectId } = require("mongodb");

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

    app.post("/api/orders", async (req, res) => {
      const {
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
          paymentStatus: "paid",
          orderStatus: "processing",
          createdAt: new Date(),
        };

        const result = await ordersCollection.insertOne(order);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/api/orders", async (req, res) => {
      const buyerId = req.query.buyerId;
      const sellerId = req.query.sellerId;

      let query = {};
      if (buyerId) {
        query = { "buyerInfo.userId": buyerId };
      }
      if (sellerId) {
        query = { "sellerInfo.userId": sellerId };
      }

      try {
        const result = await ordersCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

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
                from: "products", // adjust to your actual products collection name
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
      const { ObjectId } = require("mongodb");
      try {
        const result = await wishlistCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log("server started.");
});
