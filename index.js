const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.9nztkwc.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const jwtVerify = (req, res, next) => {
  const token = req.headers.authorization;
  if (token) {
    jwt.verify(token, process.env.ACCESS_KEY, (err, decoded) => {
      if (err) {
        res.status(401).send({ message: "unauthorizad" });
      } else {
        req.decoded = decoded;
        next();
      }
    });
  } else {
    res.status(401).send({ message: "unauthorizad" });
  }
};

async function run() {
  const doctorListCollection = client.db("docHouse").collection("doctorList");
  const userListCollection = client.db("docHouse").collection("userList");
  const bookingListCollection = client.db("docHouse").collection("bookingList");
  const paymentCollection = client.db("docHouse").collection("payment");

  const serviceCollection = client
    .db("docHouse")
    .collection("serviceCollection");

  const verifyAdmin = async (req, res, next) => {
    const isExits = await userListCollection.findOne({
      userUid: { $eq: req.query.uid },
    });

    if (isExits?.role === "admin") {
      req.query.role = isExits.role;
      next();
    } else {
      res.send({ role: isExits?.role });
    }
  };

  try {
    // JWT
    app.post("/jwt", (req, res) => {
      const data = req.body;
      const token = jwt.sign(data, process.env.ACCESS_KEY, {
        expiresIn: "30days",
      });
      res.send({ token });
    });

    // Admin
    app.get("/admin", verifyAdmin, async (req, res) => {
      res.send({ role: req.query.role });
    });

    // Payment
    app.post("/payments", async (req, res) => {
      const body = req.body;
      const result = await paymentCollection.insertOne(body);
      const query = { _id: new ObjectId(body.bookingID) };
      const deleteResult = await bookingListCollection.deleteOne(query);
      res.send({ result, deleteResult });
    });

    app.get("/allPayments", jwtVerify, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });
    app.get("/payments", async (req, res) => {
      const result = await paymentCollection
        .find({
          email: { $eq: req.query.email },
        })
        .toArray();
      res.send(result);
    });

    // create payment intent

    app.post("/create-payment-intent", async (req, res) => {
      const { fees } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: fees * 100,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // booking list
    app.get("/bookingList", async (req, res) => {
      const result = await bookingListCollection
        .find({
          email: { $eq: req.query.email },
        })
        .toArray();
      res.send(result);
    });

    app.get("/booked", async (req, res) => {
      const result = await paymentCollection.findOne({
        $and: [
          { bookingDate: { $eq: req.query.date } },
          { bookingSlot: { $eq: req.query.slot } },
          { serviceName: { $eq: req.query.name } },
        ],
      });
      if (result) {
        res.send({ message: false });
      } else {
        res.send({ message: true });
      }
    });

    app.get("/bookingList/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingListCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.post("/bookingList", async (req, res) => {
      const body = req.body;
      const result = await bookingListCollection.insertOne(body);
      res.send(result);
    });

    // services
    app.get("/services", async (req, res) => {
      const result = await serviceCollection.find().toArray();
      res.send(result);
    });

    // USERS
    app.get("/users", jwtVerify, async (req, res) => {
      if (req.decoded.uid === req.query.uid) {
        const result = await userListCollection.find().toArray();
        res.send(result);
      } else {
        res.status(403).send({ message: "Forbidden" });
      }
    });

    app.delete("/users/:id", async (req, res) => {
      const data = req.params.id;
      const query = { _id: new ObjectId(data) };
      admin
        .auth()
        .deleteUser(req.query.userUid)
        .then(async () => {
          const result = await userListCollection.deleteOne(query);
          res.send(result);
        });
    });

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userListCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const data = req.body;
      const isExits = await userListCollection.findOne({
        userEmail: { $eq: req.body.userEmail },
      });
      if (!isExits) {
        const result = await userListCollection.insertOne(data);
        res.send(result);
      }
      res.send("user already  exists");
    });

    //    DOCTOR
    app.get("/doctorList", jwtVerify, async (req, res) => {
      if (req.decoded.uid === req.query.uid) {
        const result = await doctorListCollection.find().toArray();
        res.send(result);
      } else {
        res.status(403).send({ message: "Forbidden" });
      }
    });

    app.get("/doctorDetails/:id", async (req, res) => {
      const id = req.params.id;
      const result = await doctorListCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.delete("/doctorList/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      admin
        .auth()
        .deleteUser(req.query.uid)
        .then(async () => {
          const result = await doctorListCollection.deleteOne(query);
          res.send(result);
        });
    });

    app.post("/doctorList", async (req, res) => {
      const data = req.body;
      const isExits = await doctorListCollection.findOne({
        doctorEmail: { $eq: req.body.doctorEmail },
      });
      if (!isExits) {
        admin
          .auth()
          .createUser({
            email: data.doctorEmail,
            password: "123456",
            displayName: data.doctorName,
            photoURL: data.doctorImg,
          })
          .then(async (user) => {
            const result = await doctorListCollection.insertOne({
              uid: user.uid,
              ...data,
            });
            res.send(result);
          })
          .catch((err) => {
            console.log(err);
          });
      } else {
        return res.send("user already exists");
      }
    });

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Doc house is running");
});

app.listen(port, () => {
  console.log(`server is running : ${port}`);
});
