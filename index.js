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

    app.post("/api/products", async (req, res) => {
      const data = req.body;
      const result = await productsCollection.insertOne(data);
      res.send(result);
    });

    app.get("/api/products", async (req, res) => {
      const sellerId = req.query.sellerId;
      const search = req.query.search || "";
      const sort = req.query.sort || "newest"; // newest, priceLow, priceHigh
      const page = parseInt(req.query.page) || 1;
      const limit = 9;
      const skip = (page - 1) * limit;

      let query = {};

      if (sellerId) {
        query = { "sellerInfo.userId": sellerId };
      }

      if (search) {
        query.title = { $regex: search, $options: "i" };
      }

      let sortObj = { createdAt: -1 }; // newest by default
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
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log("server started.");
});
