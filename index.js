const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken"); 

const app = express();
const port = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET);

app.use(
  cors({
    origin: ["http://localhost:3000", process.env.CLIENT_URL],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ MongoDB connected");

    const db = client.db("GymCare");

    const usersCollection = db.collection("user");
    const classesCollection = db.collection("classes");
    const bookingsCollection = db.collection("bookings");
    const favoritesCollection = db.collection("favorites");
    const forumPostsCollection = db.collection("forumPosts");
    const commentsCollection = db.collection("comments");
    const trainerApplicationsCollection = db.collection("trainerApplications");
    const notificationsCollection = db.collection("notifications");

    
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.query.email || req.body.userEmail;
        if (!email) return res.status(401).send({ error: "Unauthorized: No email provided." });

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "admin") {
          return res.status(403).send({ error: "Forbidden: Admin access required." });
        }
        next();
      } catch (error) {
        console.error("verifyAdmin error:", error);
        res.status(500).send({ error: "Failed to verify admin." });
      }
    };

    
    const checkBlocked = async (email) => {
      const user = await usersCollection.findOne({ email });
      return user?.status === "Blocked";
    };

    
    const verifyToken = (req, res, next) => {
      const token = req.cookies?.token;

      if (!token) {
        return res.status(401).send({ error: "Unauthorized: No token provided." });
      }

      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ error: "Unauthorized: Invalid or expired token." });
        }
        req.decoded = decoded; 
        next();
      });
    };

   
    const verifyRole = (...allowedRoles) => {
      return (req, res, next) => {
        if (!req.decoded || !allowedRoles.includes(req.decoded.role)) {
          return res.status(403).send({ error: "Forbidden: Insufficient permissions." });
        }
        next();
      };
    };

    
    app.post("/jwt", async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) {
          return res.status(400).send({ error: "Email is required." });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ error: "User not found." });
        }

        const token = jwt.sign(
          { email: user.email, role: user.role || "user" },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );

        res
          .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
          })
          .send({ success: true });
      } catch (error) {
        console.error("POST /jwt error:", error);
        res.status(500).send({ error: "Failed to generate token." });
      }
    });

   
    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        })
        .send({ success: true });
    });

    
    app.get("/api/classes", async (req, res) => {
      try {
        const search = req.query.search || "";
        const category = req.query.category || "";
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;

        const filter = { status: "Approved" };
        if (search) filter.name = { $regex: search, $options: "i" };
        if (category) filter.category = { $in: category.split(",") };

        const totalCount = await classesCollection.countDocuments(filter);
        const totalPages = Math.ceil(totalCount / limit);

        const classes = await classesCollection
          .find(filter)
          .sort({ bookingCount: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ classes, totalPages, totalCount });
      } catch (error) {
        console.error("GET /api/classes error:", error);
        res.status(500).send({ message: "Failed to fetch classes." });
      }
    });

    app.get("/api/classes/:id", async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({ message: "Invalid class ID." });
        }
        const cls = await classesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!cls) return res.status(404).send({ message: "Class not found." });
        res.send(cls);
      } catch (error) {
        console.error("GET /api/classes/:id error:", error);
        res.status(500).send({ message: "Failed to fetch class." });
      }
    });

    
    app.get("/forum-posts", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        const totalCount = await forumPostsCollection.countDocuments();
        const posts = await forumPostsCollection
          .find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          posts,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount,
            limit,
          },
        });
      } catch (error) {
        console.error("GET /forum-posts error:", error);
        res.status(500).send({ error: "Failed to fetch forum posts" });
      }
    });

    app.get("/forum-posts/latest", async (req, res) => {
      try {
        const posts = await forumPostsCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(4)
          .toArray();
        res.send({ posts });
      } catch (error) {
        console.error("GET /forum-posts/latest error:", error);
        res.status(500).send({ error: "Failed to fetch latest posts" });
      }
    });

    app.post("/forum-posts", async (req, res) => {
      try {
        const { title, image, description, authorName, authorEmail, authorRole } = req.body;

        if (!title?.trim() || !description?.trim() || !authorEmail) {
          return res.status(400).send({ error: "Title, description, and author are required." });
        }

        const post = {
          title: title.trim(),
          image: image?.trim() || "",
          description: description.trim(),
          authorName,
          authorEmail,
          authorRole: authorRole || "user",
          likes: [],
          dislikes: [],
          createdAt: new Date(),
        };

        const result = await forumPostsCollection.insertOne(post);
        res.status(201).send({ success: true, post: { ...post, _id: result.insertedId } });
      } catch (error) {
        console.error("POST /forum-posts error:", error);
        res.status(500).send({ error: "Failed to create post" });
      }
    });

    app.get("/forum-posts/my", async (req, res) => {
      try {
        const { authorEmail } = req.query;
        if (!authorEmail) return res.status(400).send({ error: "authorEmail required" });

        const posts = await forumPostsCollection
          .find({ authorEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(posts);
      } catch (error) {
        console.error("GET /forum-posts/my error:", error);
        res.status(500).send({ error: "Failed to fetch posts." });
      }
    });

    app.get("/forum-posts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid post ID" });

        const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).send({ error: "Post not found" });
        res.send(post);
      } catch (error) {
        console.error("GET /forum-posts/:id error:", error);
        res.status(500).send({ error: "Failed to fetch post" });
      }
    });

    app.delete("/forum-posts/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { authorEmail } = req.query;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid post ID" });

        const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).send({ error: "Post not found." });

        if (post.authorEmail !== authorEmail) {
          return res.status(403).send({ error: "You can only delete your own post." });
        }

        await forumPostsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
      } catch (error) {
        console.error("DELETE /forum-posts/:id error:", error);
        res.status(500).send({ error: "Failed to delete post" });
      }
    });

    app.post("/forum-posts/:id/vote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail, voteType } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid post ID" });
        if (!userEmail || !["like", "dislike"].includes(voteType)) {
          return res.status(400).send({ error: "Invalid vote request" });
        }

        const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).send({ error: "Post not found" });

        const likes = post.likes || [];
        const dislikes = post.dislikes || [];
        const hasLiked = likes.includes(userEmail);
        const hasDisliked = dislikes.includes(userEmail);

        let update;
        if (voteType === "like") {
          update = hasLiked
            ? { $pull: { likes: userEmail } }
            : { $addToSet: { likes: userEmail }, $pull: { dislikes: userEmail } };
        } else {
          update = hasDisliked
            ? { $pull: { dislikes: userEmail } }
            : { $addToSet: { dislikes: userEmail }, $pull: { likes: userEmail } };
        }

        await forumPostsCollection.updateOne({ _id: new ObjectId(id) }, update);
        const updatedPost = await forumPostsCollection.findOne({ _id: new ObjectId(id) });

        res.send({
          likesCount: updatedPost.likes?.length || 0,
          dislikesCount: updatedPost.dislikes?.length || 0,
          userVote: updatedPost.likes?.includes(userEmail)
            ? "like"
            : updatedPost.dislikes?.includes(userEmail)
            ? "dislike"
            : null,
        });
      } catch (error) {
        console.error("POST /forum-posts/:id/vote error:", error);
        res.status(500).send({ error: "Failed to register vote" });
      }
    });

   
    app.get("/comments/:postId", async (req, res) => {
      try {
        const comments = await commentsCollection
          .find({ postId: req.params.postId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send({ comments });
      } catch (error) {
        console.error("GET /comments/:postId error:", error);
        res.status(500).send({ error: "Failed to fetch comments" });
      }
    });

    app.post("/comments", async (req, res) => {
      try {
        const { postId, userEmail, userName, userImage, text } = req.body;

        if (!postId || !userEmail || !text?.trim()) {
          return res.status(400).send({ error: "Missing fields" });
        }

        const blocked = await checkBlocked(userEmail);
        if (blocked) {
          return res.status(403).send({ error: "Action restricted by Admin." });
        }

        const comment = {
          postId,
          userEmail,
          userName,
          userImage,
          text: text.trim(),
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(comment);
        res.send({ success: true, comment: { ...comment, _id: result.insertedId } });
      } catch (error) {
        console.error("POST /comments error:", error);
        res.status(500).send({ error: "Failed to add comment" });
      }
    });

    app.patch("/comments/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail, text } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid comment ID" });

        const comment = await commentsCollection.findOne({ _id: new ObjectId(id) });
        if (!comment) return res.status(404).send({ error: "Comment not found" });

        if (comment.userEmail !== userEmail) {
          return res.status(403).send({ error: "You can only edit your own comment" });
        }

        await commentsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { text: text.trim(), editedAt: new Date() } }
        );
        res.send({ success: true });
      } catch (error) {
        console.error("PATCH /comments/:id error:", error);
        res.status(500).send({ error: "Failed to update comment" });
      }
    });

    app.delete("/comments/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail } = req.query;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid comment ID" });

        const comment = await commentsCollection.findOne({ _id: new ObjectId(id) });
        if (!comment) return res.status(404).send({ error: "Comment not found" });

        if (comment.userEmail !== userEmail) {
          return res.status(403).send({ error: "You can only delete your own comment" });
        }

        await commentsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
      } catch (error) {
        console.error("DELETE /comments/:id error:", error);
        res.status(500).send({ error: "Failed to delete comment" });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BOOKING ROUTES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.post("/bookings/check", async (req, res) => {
      try {
        const { classId, userEmail } = req.body;

        if (!ObjectId.isValid(classId)) {
          return res.status(400).send({ error: "Invalid class ID" });
        }

        const existingBooking = await bookingsCollection.findOne({
          classId: classId,
          attendeeEmail: userEmail,
        });

        res.send({ alreadyBooked: !!existingBooking });
      } catch (error) {
        console.error("POST /bookings/check error:", error);
        res.status(500).send({ error: "Failed to check booking" });
      }
    });

   app.get("/bookings/my", async (req, res) => {
  try {
    const { userEmail } = req.query;
    if (!userEmail) return res.status(400).send({ error: "userEmail required" });

    // MongoDB Aggregation Pipeline ব্যবহার করে ক্লাসের শিডিউল নিয়ে আসা হচ্ছে
    const bookings = await bookingsCollection.aggregate([
      {
        $match: { attendeeEmail: userEmail }
      },
      {
        // classId স্ট্রিং হলে সেটিকে ObjectId তে রূপান্তর করে classesCollection এর সাথে ম্যাচ করা হচ্ছে
        $addFields: {
          convertedClassId: { $toObjectId: "$classId" }
        }
      },
      {
        $lookup: {
          from: "classes",          // আপনার ক্লাসের কালেকশনের নাম (যেমন: classes)
          localField: "convertedClassId",
          foreignField: "_id",
          as: "classDetails"
        }
      },
      {
        $unwind: {
          path: "$classDetails",
          preserveNullAndEmptyArrays: true // ক্লাস ডিলিট হয়ে গেলেও বুকিং ডেটা দেখাবে
        }
      },
      {
        $project: {
          _id: 1,
          classId: 1,
          className: 1,
          trainerName: 1,
          attendeeEmail: 1,
          price: 1,
          transactionId: 1,
          paymentStatus: 1,
          bookedAt: 1,
          schedule: { 
            $ifNull: [
              "$classDetails.schedule", 
              { $ifNull: ["$classDetails.slot", { $ifNull: ["$classDetails.slotTime", "—"] }] }
            ] 
          }
        }
      },
      {
        $sort: { bookedAt: -1 }
      }
    ]).toArray();

    res.send({ bookings });
  } catch (error) {
    console.error("GET /bookings/my error:", error);
    res.status(500).send({ error: "Failed to fetch bookings" });
  }
});

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FAVORITES ROUTES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/favorites/check", async (req, res) => {
      try {
        const { classId, userEmail } = req.query;

        const existingFavorite = await favoritesCollection.findOne({ classId, userEmail });
        res.send({
          isFavorite: !!existingFavorite,
          favoriteId: existingFavorite?._id ?? null,
        });
      } catch (error) {
        console.error("GET /favorites/check error:", error);
        res.status(500).send({ error: "Failed to check favorite" });
      }
    });

    app.post("/favorites", async (req, res) => {
      try {
        const { classId, userEmail, className, classImage } = req.body;

        const existing = await favoritesCollection.findOne({ classId, userEmail });
        if (existing) return res.status(409).send({ error: "Already in favorites" });

        const result = await favoritesCollection.insertOne({
          classId,
          userEmail,
          className,
          classImage,
          createdAt: new Date(),
        });
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("POST /favorites error:", error);
        res.status(500).send({ error: "Failed to add favorite" });
      }
    });

    app.delete("/favorites/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid favorite ID" });

        await favoritesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
      } catch (error) {
        console.error("DELETE /favorites/:id error:", error);
        res.status(500).send({ error: "Failed to remove favorite" });
      }
    });

    app.get("/favorites/my", async (req, res) => {
      try {
        const { userEmail } = req.query;
        if (!userEmail) return res.status(400).send({ error: "userEmail required" });

        const favorites = await favoritesCollection
          .find({ userEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send({ favorites });
      } catch (error) {
        console.error("GET /favorites/my error:", error);
        res.status(500).send({ error: "Failed to fetch favorites" });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // USER DASHBOARD STATS — 🔴 JWT protected
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ━━ AFTER — fix kora version ━━

app.get("/dashboard/user-stats", async (req, res) => {
  try {
    const { userEmail } = req.query; // query param theke nao
    if (!userEmail) return res.status(400).send({ error: "userEmail required" });

    const [bookedCount, favoritesCount] = await Promise.all([
      bookingsCollection.countDocuments({ attendeeEmail: userEmail }),
      favoritesCollection.countDocuments({ userEmail }),
    ]);
    res.send({ bookedCount, favoritesCount });
  } catch (error) {
    console.error("GET /dashboard/user-stats error:", error);
    res.status(500).send({ error: "Failed to fetch stats" });
  }
});

app.get("/api/admin/stats", verifyAdmin, async (req, res) => {
  // verifyToken, verifyRole remove — verifyAdmin e enough
  try {
    const [totalUsers, totalClasses, totalApprovedClasses, totalBookedClasses] =
      await Promise.all([
        usersCollection.countDocuments(),
        classesCollection.countDocuments(),
        classesCollection.countDocuments({ status: "Approved" }),
        bookingsCollection.countDocuments(),
      ]);

    const classesByCategory = await classesCollection
      .aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    const usersByRole = await usersCollection
      .aggregate([
        { $group: { _id: { $ifNull: ["$role", "user"] }, count: { $sum: 1 } } },
      ])
      .toArray();

    res.send({
      totalUsers,
      totalClasses,
      totalApprovedClasses,
      totalBookedClasses,
      classesByCategory: classesByCategory.map((c) => ({ category: c._id, count: c.count })),
      usersByRole: usersByRole.map((u) => ({ role: u._id, count: u.count })),
    });
  } catch (error) {
    console.error("GET /api/admin/stats error:", error);
    res.status(500).send({ error: "Failed to fetch admin stats." });
  }
});

app.get("/trainer/stats", async (req, res) => {
  // verifyToken, verifyRole remove — query param use koro
  try {
    const { trainerEmail } = req.query;
    if (!trainerEmail) return res.status(400).send({ error: "trainerEmail required" });

    const myClasses = await classesCollection.find({ trainerEmail }).toArray();
    const classIds = myClasses.map((c) => c._id.toString());

    const totalStudents = await bookingsCollection.countDocuments({
      classId: { $in: classIds },
    });

    res.send({ totalClasses: myClasses.length, totalStudents });
  } catch (error) {
    console.error("GET /trainer/stats error:", error);
    res.status(500).send({ error: "Failed to fetch trainer stats." });
  }
});
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TRAINER APPLICATIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/trainer-applications/my", async (req, res) => {
      try {
        const { userEmail } = req.query;

        if (!userEmail) {
          return res.status(400).send({ success: false, message: "userEmail required" });
        }

        const application = await trainerApplicationsCollection.findOne({ userEmail });

        if (!application) {
          return res.send({ success: true, application: null });
        }

        res.send({
          success: true,
          application: {
            _id: application._id,
            userName: application.userName,
            userEmail: application.userEmail,
            specialty: application.specialty,
            experience: application.experience,
            status: application.status || "Pending",
            feedback: application.feedback || "",
            createdAt: application.createdAt,
          },
        });
      } catch (error) {
        console.log(error);
        res.status(500).send({ success: false, message: "Failed to fetch application" });
      }
    });

    app.post("/trainer-applications", async (req, res) => {
      try {
        const { userEmail, userName, experience, specialty, bio } = req.body;

        if (!userEmail || !experience || !specialty) {
          return res.status(400).send({ error: "Missing required fields" });
        }

        const blocked = await checkBlocked(userEmail);
        if (blocked) {
          return res.status(403).send({ error: "Action restricted by Admin." });
        }

        const existingPending = await trainerApplicationsCollection.findOne({
          userEmail,
          status: "Pending",
        });
        if (existingPending) {
          return res.status(409).send({ error: "You already have a pending application." });
        }

        const result = await trainerApplicationsCollection.insertOne({
          userEmail,
          userName,
          experience,
          specialty,
          bio: bio || "",
          status: "Pending",
          feedback: null,
          appliedAt: new Date(),
        });
        res.status(201).send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("POST /trainer-applications error:", error);
        res.status(500).send({ error: "Failed to submit application" });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PAYMENT / STRIPE ROUTES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { classId, userEmail } = req.body;

        if (!ObjectId.isValid(classId)) {
          return res.status(400).send({ error: "Invalid class ID" });
        }

        const blocked = await checkBlocked(userEmail);
        if (blocked) {
          return res.status(403).send({ error: "Action restricted by Admin." });
        }

        const existingBooking = await bookingsCollection.findOne({
          classId: classId,
          attendeeEmail: userEmail,
        });
        if (existingBooking) {
          return res.status(409).send({ error: "You have already booked this class." });
        }

        const cls = await classesCollection.findOne({ _id: new ObjectId(classId) });
        if (!cls) return res.status(404).send({ error: "Class not found." });

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: cls.name,
                  description: `Trainer: ${cls.trainerName}`,
                },
                unit_amount: Math.round(cls.price * 100),
              },
              quantity: 1,
            },
          ],
          metadata: { classId, userEmail },
          success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/classes/${classId}`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("POST /create-checkout-session error:", error);
        res.status(500).send({ error: "Failed to create checkout session." });
      }
    });

    app.get("/verify-payment/:sessionId", async (req, res) => {
      try {
        const { sessionId } = req.params;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ error: "Payment not completed." });
        }

        const { classId, userEmail } = session.metadata;

        const existingBooking = await bookingsCollection.findOne({
          classId,
          attendeeEmail: userEmail,
        });
        if (existingBooking) {
          return res.send({ success: true, booking: existingBooking, alreadyExisted: true });
        }

        const cls = await classesCollection.findOne({ _id: new ObjectId(classId) });

        const bookingDoc = {
          classId,
          className: cls?.name,
          trainerName: cls?.trainerName,
          attendeeEmail: userEmail,
          price: cls?.price,
          transactionId: session.payment_intent,
          paymentStatus: "paid",
          bookedAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(bookingDoc);

        await classesCollection.updateOne(
          { _id: new ObjectId(classId) },
          { $inc: { bookingCount: 1 } }
        );

        res.send({ success: true, booking: { ...bookingDoc, _id: result.insertedId } });
      } catch (error) {
        console.error("GET /verify-payment/:sessionId error:", error);
        res.status(500).send({ error: "Failed to verify payment." });
      }
    });




// ── GET /notifications  —  User er shob notification ──────────────────
app.get("/notifications", async (req, res) => {
  try {
    const { userEmail } = req.query;

    if (!userEmail) {
      return res.status(400).send({ error: "userEmail required" });
    }

    const notifications = await notificationsCollection
      .find({ userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ notifications });
  } catch (error) {
    console.error("GET /notifications error:", error);
    res.status(500).send({ error: "Failed to fetch notifications." });
  }
});

// ── PATCH /notifications/:id/read  —  Single notification read mark ───
app.patch("/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid ID" });

    await notificationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { read: true } }
    );
    res.send({ success: true });
  } catch (error) {
    console.error("PATCH /notifications/:id/read error:", error);
    res.status(500).send({ error: "Failed to mark notification as read." });
  }
});

// ── PATCH /notifications/read-all  —  Shob notification read mark ─────
app.patch("/notifications/read-all", async (req, res) => {
  try {
    const { userEmail } = req.body;
    if (!userEmail) return res.status(400).send({ error: "userEmail required" });

    await notificationsCollection.updateMany(
      { userEmail, read: false },
      { $set: { read: true } }
    );
    res.send({ success: true });
  } catch (error) {
    console.error("PATCH /notifications/read-all error:", error);
    res.status(500).send({ error: "Failed to mark all as read." });
  }
});

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — CHECK ROLE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/check-admin", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).send({ error: "email required" });

        const user = await usersCollection.findOne({ email });
        res.send({ isAdmin: user?.role === "admin" });
      } catch (error) {
        console.error("GET /api/check-admin error:", error);
        res.status(500).send({ error: "Failed to check admin status." });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — STATS — 🔴 JWT + role double protection
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/admin/stats", verifyToken, verifyRole("admin"), verifyAdmin, async (req, res) => {
      try {
        const [totalUsers, totalClasses, totalApprovedClasses, totalBookedClasses] =
          await Promise.all([
            usersCollection.countDocuments(),
            classesCollection.countDocuments(),
            classesCollection.countDocuments({ status: "Approved" }),
            bookingsCollection.countDocuments(),
          ]);

        const classesByCategory = await classesCollection
          .aggregate([
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray();

        const usersByRole = await usersCollection
          .aggregate([
            { $group: { _id: { $ifNull: ["$role", "user"] }, count: { $sum: 1 } } },
          ])
          .toArray();

        res.send({
          totalUsers,
          totalClasses,
          totalApprovedClasses,
          totalBookedClasses,
          classesByCategory: classesByCategory.map((c) => ({ category: c._id, count: c.count })),
          usersByRole: usersByRole.map((u) => ({ role: u._id, count: u.count })),
        });
      } catch (error) {
        console.error("GET /api/admin/stats error:", error);
        res.status(500).send({ error: "Failed to fetch admin stats." });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — USERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/admin/users", verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().sort({ createdAt: -1 }).toArray();
        res.send(users);
      } catch (error) {
        console.error("GET /api/admin/users error:", error);
        res.status(500).send({ error: "Failed to fetch users." });
      }
    });

    app.patch("/api/admin/users/:id/role", verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid user ID" });
        if (!["admin", "trainer", "user"].includes(role)) {
          return res.status(400).send({ error: "Invalid role" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("PATCH /api/admin/users/:id/role error:", error);
        res.status(500).send({ error: "Failed to update role." });
      }
    });

    app.patch("/api/admin/users/:id/status", verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid user ID" });
        if (!["Active", "Blocked"].includes(status)) {
          return res.status(400).send({ error: "Invalid status" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("PATCH /api/admin/users/:id/status error:", error);
        res.status(500).send({ error: "Failed to update status." });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — MANAGE TRAINERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/admin/trainers", verifyAdmin, async (req, res) => {
      try {
        const trainers = await usersCollection
          .find({ role: "trainer" })
          .sort({ createdAt: -1 })
          .toArray();

        res.send({ success: true, total: trainers.length, trainers });
      } catch (error) {
        console.error("GET /api/admin/trainers error:", error);
        res.status(500).send({ success: false, error: "Failed to fetch trainers" });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — CLASSES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/admin/classes", verifyAdmin, async (req, res) => {
      try {
        const status = req.query.status;
        const filter = status ? { status } : {};

        const classes = await classesCollection.find(filter).sort({ _id: -1 }).toArray();
        res.send(classes);
      } catch (error) {
        console.error("GET /api/admin/classes error:", error);
        res.status(500).send({ error: "Failed to fetch classes." });
      }
    });

    app.patch("/api/admin/classes/:id/status", verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid class ID" });
        if (!["Approved", "Rejected", "Pending"].includes(status)) {
          return res.status(400).send({ error: "Invalid status" });
        }

        const result = await classesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("PATCH /api/admin/classes/:id/status error:", error);
        res.status(500).send({ error: "Failed to update class status." });
      }
    });

    app.delete("/api/admin/classes/:id", verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid class ID" });

        await classesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
      } catch (error) {
        console.error("DELETE /api/admin/classes/:id error:", error);
        res.status(500).send({ error: "Failed to delete class." });
      }
    });

    app.get("/api/admin/trainer-applications", verifyAdmin, async (req, res) => {
      try {
        const status = req.query.status;
        const filter = status ? { status } : {};

        const applications = await trainerApplicationsCollection
          .find(filter)
          .sort({ _id: -1 })
          .toArray();
        res.send(applications);
      } catch (error) {
        console.error("GET /api/admin/trainer-applications error:", error);
        res.status(500).send({ error: "Failed to fetch applications." });
      }
    });

   app.patch("/api/admin/trainer-applications/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback } = req.body;

    if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid application ID" });

    // Age application fetch koro — notification e userEmail lagbe
    const application = await trainerApplicationsCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!application) return res.status(404).send({ error: "Application not found." });

    await trainerApplicationsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          feedback: status === "Rejected" ? feedback : "",
          updatedAt: new Date(),
        },
      }
    );

     if (status === "Approved") {
      await usersCollection.updateOne(
        { email: application.userEmail },
        { $set: { role: "trainer" } }
      );

      await notificationsCollection.insertOne({
        userEmail: application.userEmail,
        type: "trainer_approved",
        title: "Trainer Application Approved!",
        message:
          "Congratulations! Your trainer application has been approved.",
        read: false,
        createdAt: new Date(),
      });
    }
    if (status === "Rejected") {
      // Rejection notification
      await notificationsCollection.insertOne({
        userEmail: application.userEmail,
        type: "trainer_rejected",
        title: "Trainer Application Update",
        message: feedback
          ? `Your application was not approved. Admin feedback: "${feedback}"`
          : "Your trainer application was not approved this time. You can apply again.",
        read: false,
        createdAt: new Date(),
      });
    }

    res.send({ success: true });
  } catch (err) {
    console.error("PATCH /api/admin/trainer-applications/:id error:", err);
    res.status(500).send({ success: false });
  }
});

    app.patch("/api/admin/trainers/:id/demote", verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid user ID" });

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "user" } }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("PATCH /api/admin/trainers/:id/demote error:", error);
        res.status(500).send({ error: "Failed to demote trainer." });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — FORUM MODERATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/admin/forum-posts", verifyAdmin, async (req, res) => {
      try {
        const posts = await forumPostsCollection.find().sort({ createdAt: -1 }).toArray();
        res.send({ posts });
      } catch (error) {
        console.error("GET /api/admin/forum-posts error:", error);
        res.status(500).send({ error: "Failed to fetch posts" });
      }
    });

    app.delete("/api/admin/forum-posts/:id", verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid post ID" });

        await forumPostsCollection.deleteOne({ _id: new ObjectId(id) });
        await commentsCollection.deleteMany({ postId: id });
        res.send({ success: true });
      } catch (error) {
        console.error("DELETE /api/admin/forum-posts/:id error:", error);
        res.status(500).send({ error: "Failed to delete post" });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN — TRANSACTIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/api/admin/transactions", verifyAdmin, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const totalCount = await bookingsCollection.countDocuments({ paymentStatus: "paid" });

        const transactions = await bookingsCollection
          .find({ paymentStatus: "paid" })
          .sort({ bookedAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          transactions,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount,
          },
        });
      } catch (error) {
        console.error("GET /api/admin/transactions error:", error);
        res.status(500).send({ error: "Failed to fetch transactions" });
      }
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TRAINER ROUTES — 🔴 JWT + role protected
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    app.get("/trainer/stats", verifyToken, verifyRole("trainer"), async (req, res) => {
      try {
        const trainerEmail = req.decoded.email; // 🔴 token থেকে নেওয়া

        const myClasses = await classesCollection.find({ trainerEmail }).toArray();
        const classIds = myClasses.map((c) => c._id.toString());

        const totalStudents = await bookingsCollection.countDocuments({
          classId: { $in: classIds },
        });

        res.send({ totalClasses: myClasses.length, totalStudents });
      } catch (error) {
        console.error("GET /trainer/stats error:", error);
        res.status(500).send({ error: "Failed to fetch trainer stats." });
      }
    });

    app.post("/classes", async (req, res) => {
      try {
        const {
          name, image, category, difficulty, duration,
          schedule, price, description, trainerName, trainerEmail,
        } = req.body;

        if (!name || !category || !difficulty || !duration || !price || !trainerEmail) {
          return res.status(400).send({ error: "Missing required fields" });
        }

        const newClass = {
          name, image, category, difficulty, duration, schedule,
          price: Number(price), description, trainerName, trainerEmail,
          status: "Pending",
          bookingCount: 0,
          createdAt: new Date(),
        };

        const result = await classesCollection.insertOne(newClass);
        res.status(201).send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("POST /classes error:", error);
        res.status(500).send({ error: "Failed to add class." });
      }
    });

    app.get("/classes/my", async (req, res) => {
      try {
        const { trainerEmail } = req.query;
        if (!trainerEmail) return res.status(400).send({ error: "trainerEmail required" });

        const classes = await classesCollection
          .find({ trainerEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(classes);
      } catch (error) {
        console.error("GET /classes/my error:", error);
        res.status(500).send({ error: "Failed to fetch classes." });
      }
    });

    app.patch("/classes/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { trainerEmail, ...updateFields } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid class ID" });

        const cls = await classesCollection.findOne({ _id: new ObjectId(id) });
        if (!cls) return res.status(404).send({ error: "Class not found." });

        if (cls.trainerEmail !== trainerEmail) {
          return res.status(403).send({ error: "You can only edit your own classes." });
        }

        if (updateFields.price) updateFields.price = Number(updateFields.price);

        await classesCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateFields });
        res.send({ success: true });
      } catch (error) {
        console.error("PATCH /classes/:id error:", error);
        res.status(500).send({ error: "Failed to update class." });
      }
    });

    app.delete("/classes/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { trainerEmail } = req.query;

        if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid class ID" });

        const cls = await classesCollection.findOne({ _id: new ObjectId(id) });
        if (!cls) return res.status(404).send({ error: "Class not found." });

        if (cls.trainerEmail !== trainerEmail) {
          return res.status(403).send({ error: "You can only delete your own classes." });
        }

        await classesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
      } catch (error) {
        console.error("DELETE /classes/:id error:", error);
        res.status(500).send({ error: "Failed to delete class." });
      }
    });

    app.get("/classes/:id/attendees", async (req, res) => {
      try {
        const { id } = req.params;
        const bookings = await bookingsCollection.find({ classId: id }).toArray();

        const attendees = bookings.map((b) => ({
          email: b.attendeeEmail,
          bookedAt: b.bookedAt,
        }));
        res.send({ attendees });
      } catch (error) {
        console.error("GET /classes/:id/attendees error:", error);
        res.status(500).send({ error: "Failed to fetch attendees." });
      }
    });
  } catch (error) {
    console.error("MongoDB error:", error);
  }
}

run();

app.get("/", (req, res) => {
  res.send("Server running 🏋️");
});

app.listen(port, () => {
  console.log("Server running on", port);
});