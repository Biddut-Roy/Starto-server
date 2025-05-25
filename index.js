require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { MongoClient } = require("mongodb");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: ["https://www.startolive.site", "http://localhost:3000"],
    credentials: true,
  })
);

app.use(express.json());

// MongoDB Connection URL
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("Starto-jpy");
    const collection = db.collection("users");
    const collectionPaymentMethods = db.collection("paymentMethods");
    const collectionIMG = db.collection("bgIMG");

    // User Registration
    app.post("/api/v1/register", async (req, res) => {
      const { email, password } = req.body;

      // Check if email already exists
      const existingUser = await collection.findOne({ email });
      if (existingUser) {
        // Compare hashed password

        const userU = await collection.findOneAndUpdate(
          { email },
          { $set: { login: "true" } },
          { returnDocument: "after" }
        );

        const token = jwt.sign(
          { email: email, role: "user" },
          process.env.JWT_SECRET,
          {
            expiresIn: process.env.EXPIRES_IN,
          }
        );

        return res.status(201).json({
          message: "User registered successfully!",
          accessToken: token,
          id: userU?.id,
          email: userU?.email,
          image: userU.image || null,
        });
      }

      // Insert user into the database
      const user = await collection.insertOne({
        email,
        password,
        role: "user",
        payment: false,
      });

      const token = jwt.sign(
        { email: email, role: "user" },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.EXPIRES_IN,
        }
      );

      res.status(201).json({
        message: "User registered successfully!",
        accessToken: token,
        id: user?.id,
        email: user?.email,
        image: user.image || null,
      });
    });

    // User Login
    app.post("/api/v1/login", async (req, res) => {
      const { email, password } = req.body;

      try {
        // Find user by email
        const user = await collection.findOne({ email });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: "User not found!",
          });
        }

        // Check if the raw password matches
        if (user.password !== password) {
          return res.status(401).json({
            success: false,
            message: "Invalid credentials!",
          });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
          expiresIn: process.env.EXPIRES_IN,
        });

        res.json({
          success: true,
          message: "User successfully logged in!",
          accessToken: token,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({
          success: false,
          message: "Internal server error.",
        });
      }
    });

    // Payment From
    app.post("/api/v1/payment", async (req, res) => {
      const {
        email,
        check,
        expiryDate,
        firstName,
        lastName,
        number,
        billingAddress,
      } = req.body;

      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Email is required" });
      }

      const session = client.startSession(); // Start transaction session (MongoDB)
      try {
        session.startTransaction(); // Begin transaction

        // Update user's payment status
        const user = await collection.findOneAndUpdate(
          { email },
          { $set: { payment: true } },
          { returnDocument: "after", session }
        );

        if (!user) {
          await session.abortTransaction();
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        // Insert new payment method
        await collectionPaymentMethods.insertOne(
          {
            email,
            number,
            expiryDate,
            firstName,
            lastName,
            check,
            billingAddress,
            isDeleted: false,
          },
          { session }
        );

        await session.commitTransaction();

        const token = jwt.sign({ user }, process.env.JWT_SECRET, {
          expiresIn: process.env.EXPIRES_IN,
        });
        res.json({
          success: true,
          message: "Payment successfully processed!",
          accessToken: token,
        });
      } catch (error) {
        await session.abortTransaction(); // Rollback on error
        res.status(500).json({
          success: false,
          message: "Internal server error",
          error: error.message,
        });
      } finally {
        session.endSession(); // End transaction session
      }
    });

    app.post("/api/v1/paymentData", async (req, res) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res
            .status(400)
            .json({ success: false, message: "Email is required" });
        }
        // Debugging

        const UserData = await collection.findOne({ email });

        if (!UserData) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }
        if (UserData?.role === "admin") {
          // Include documents where isDelete is false or the field does not exist
          const filter = {
            $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
          };

          // Exclude isDelete field from the response
          const projection = { isDeleted: 0 };

          const payData = await collectionPaymentMethods
            .find(filter, { projection })
            .toArray();

          res.json({
            success: true,
            totalCount: payData.length,
            data: payData,
          });
        } else {
          res
            .status(403)
            .json({ success: false, message: "Unauthorized access" });
        }
      } catch (error) {
        console.error("Error in /api/v1/paymentData:", error); // Debugging
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.patch("/api/v1/paymentData", async (req, res) => {
      try {
        const { id } = req.body;

        if (!id) {
          return res
            .status(400)
            .json({ success: false, message: "ID is required" });
        }
        const objectId = new ObjectId(id);
        // Check if the document exists

        const paymentData = await collectionPaymentMethods.findOne({
          _id: objectId,
        });

        if (!paymentData) {
          return res
            .status(404)
            .json({ success: false, message: "Data not found" });
        }

        // Update the document by setting isDelete to true
        await collectionPaymentMethods.updateOne(
          { _id: objectId },
          { $set: { isDeleted: true } }
        );

        res.json({
          success: true,
          message: "Data successfully marked as deleted",
        });
      } catch (error) {
        console.error("Error in /api/v1/paymentData:", error); // Debugging
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // Change password route
    app.post("/api/v1/change-password", async (req, res) => {
      const { email, currentPassword, newPassword } = req.body;

      try {
        // Find the user by email
        const user = await collection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        } else {
          const isPasswordValid = await bcrypt.compare(
            currentPassword,
            user.password
          );

          if (!isPasswordValid) {
            return res
              .status(401)
              .json({ message: "Invalid email or password" });
          }
          // Hash the new password
          const hashedNewPassword = await bcrypt.hash(newPassword, 10);

          // Update the password in the database
          collection.updateOne(
            { email },
            { $set: { password: hashedNewPassword } }
          );

          return res
            .status(200)
            .json({ message: "Password updated successfully" });
        }
      } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/api/v2/sakil", async (req, res) => {
      try {
        // Include documents where isDelete is false or the field does not exist
        const filter = {
          $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
        };

        // Exclude isDelete field from the response
        const projection = { isDeleted: 0 };

        const payData = await collectionPaymentMethods
          .find(filter, { projection })
          .toArray();

        res.json({
          success: true,
          totalCount: payData.length,
          data: payData,
        });
      } catch (error) {
        console.error("Error in /api/v2/sakil:", error); // Debugging
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.put("/api/v1/img", async (req, res) => {
      try {
        const { url } = req.body;

        if (!url) {
          return res.status(400).json({ error: "Image URL is required" });
        }

        await collectionIMG.doc("background").set({ url });

        res.json({ message: "Image URL updated successfully", url });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get image URL
    app.get("/api/v1/img", async (req, res) => {
      try {
        const doc = await collectionIMG.doc("background").get();

        if (!doc.exists) {
          return res.status(404).json({ error: "No image found" });
        }

        res.json(doc.data());
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    // Start the server
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  } finally {
  }
}

run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  const serverStatus = {
    message: "Server is running smoothly",
    timestamp: new Date(),
  };
  res.json(serverStatus);
});
