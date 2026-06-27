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

const { MongoClient, ServerApiVersion } = require("mongodb");
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

      let query = {};
      if (sellerId) {
        query = { "sellerInfo.userId": sellerId };
      }

      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log("server started.");
});
