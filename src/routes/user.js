const express = require("express");
const userRouter = express.Router();

const { userAuth } = require("../middlewares/auth");
const { checkProfileComplete } = require("../middlewares/checkProfileComplete");
const ConnectionRequest = require("../models/connectionRequest");
const User = require("../models/user");
const mongoose = require("mongoose");

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium isProfileComplete";

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const normalizeSkills = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => normalizeString(v)).filter(Boolean);
  }
  // support comma-separated or single skill
  const str = normalizeString(value);
  if (!str) return [];
  if (str.includes(",")) {
    return str
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [str];
};

// Get all the pending connection request for the loggedIn user
userRouter.get("/requests/received", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequests = await ConnectionRequest.find({
      toUserId: loggedInUser._id,
      status: "interested",
    }).populate("fromUserId", USER_SAFE_DATA);
    // }).populate("fromUserId", ["firstName", "lastName"]);

    res.json({
      message: "Data fetched successfully",
      data: connectionRequests,
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// Get all the sent (outgoing) connection requests by the logged-in user
userRouter.get("/requests/sent", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequests = await ConnectionRequest.find({
      fromUserId: loggedInUser._id,
      status: "interested",
    }).populate("toUserId", USER_SAFE_DATA);

    return res.json({
      message: "Data fetched successfully",
      data: connectionRequests,
    });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

userRouter.get("/connections", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequests = await ConnectionRequest.find({
      $or: [
        { toUserId: loggedInUser._id, status: "accepted" },
        { fromUserId: loggedInUser._id, status: "accepted" },
      ],
    })
      .populate("fromUserId", USER_SAFE_DATA)
      .populate("toUserId", USER_SAFE_DATA);

    console.log(connectionRequests);

    const data = connectionRequests.map((row) => {
      if (row.fromUserId._id.toString() === loggedInUser._id.toString()) {
        return row.toUserId;
      }
      return row.fromUserId;
    });

    res.json({ data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Request failed" });
  }
});

userRouter.get("/feed", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const page = parsePositiveInt(req.query.page, 1);
    let limit = parsePositiveInt(req.query.limit, 10);
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const skills = normalizeSkills(req.query.skills);
    const experience = normalizeString(req.query.experience);
    const role = normalizeString(req.query.role);
    const availability = normalizeString(req.query.availability);
    const location = normalizeString(req.query.location);

    const connectionRequests = await ConnectionRequest.find({
      $or: [{ fromUserId: loggedInUser._id }, { toUserId: loggedInUser._id }],
    }).select("fromUserId  toUserId");

    const hideUsersFromFeed = new Set();
    connectionRequests.forEach((req) => {
      hideUsersFromFeed.add(req.fromUserId.toString());
      hideUsersFromFeed.add(req.toUserId.toString());
    });

    const filterQuery = {
      $and: [
        { _id: { $nin: Array.from(hideUsersFromFeed) } },
        { _id: { $ne: loggedInUser._id } },
        { isProfileComplete: true },
      ],
    };

    if (skills.length > 0) {
      filterQuery.skills = { $in: skills };
    }
    if (experience && experience !== "any") {
      filterQuery.experience = experience;
    }
    if (role && role !== "any") {
      filterQuery.role = role;
    }
    if (availability && availability !== "any") {
      filterQuery.availability = availability;
    }
    if (location) {
      filterQuery.location = { $regex: location, $options: "i" };
    }

    // Fetch limit+1 to compute hasMore
    const users = await User.find(filterQuery)
      .select(USER_SAFE_DATA)
      .skip(skip)
      .limit(limit + 1);

    const hasMore = users.length > limit;
    const sliced = hasMore ? users.slice(0, limit) : users;

    res.json({ data: sliced, page, limit, hasMore });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

userRouter.post("/swipe-left", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { toUserId } = req.body || {};

    if (!toUserId) {
      return res.status(400).json({ message: "toUserId is required" });
    }

    const toUser = await User.findById(toUserId);
    if (!toUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const existing = await ConnectionRequest.findOne({
      fromUserId: loggedInUser._id,
      toUserId,
    });
    if (existing) {
      return res.json({ message: "Already swiped", data: existing });
    }

    const connectionRequest = new ConnectionRequest({
      fromUserId: loggedInUser._id,
      toUserId,
      status: "ignored",
    });

    const data = await connectionRequest.save();
    res.json({ message: "Swiped left", data });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

userRouter.post("/swipe-right", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { toUserId } = req.body || {};

    if (!toUserId) {
      return res.status(400).json({ message: "toUserId is required" });
    }

    const toUser = await User.findById(toUserId);
    if (!toUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const existing = await ConnectionRequest.findOne({
      fromUserId: loggedInUser._id,
      toUserId,
    });
    if (existing) {
      // If already interested, we can still return match status based on reciprocal.
      const reciprocal = await ConnectionRequest.findOne({
        fromUserId: toUserId,
        toUserId: loggedInUser._id,
        status: "interested",
      });
      return res.json({
        message: "Already swiped",
        data: existing,
        matched: Boolean(reciprocal),
      });
    }

    const reciprocalInterested = await ConnectionRequest.findOne({
      fromUserId: toUserId,
      toUserId: loggedInUser._id,
      status: "interested",
    });

    const connectionRequest = new ConnectionRequest({
      fromUserId: loggedInUser._id,
      toUserId,
      status: "interested",
    });

    const data = await connectionRequest.save();

    if (reciprocalInterested) {
      // Mark both as accepted to represent a match
      await ConnectionRequest.updateMany(
        {
          $or: [
            { fromUserId: loggedInUser._id, toUserId },
            { fromUserId: toUserId, toUserId: loggedInUser._id },
          ],
        },
        { $set: { status: "accepted" } }
      );

      return res.json({ message: "It's a match!", data, matched: true });
    }

    res.json({ message: "Connection request sent", data, matched: false });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// View another user's profile
// Keep this at the bottom to avoid conflicting with other /user/* routes.
userRouter.get("/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const user = await User.findById(userId).select(USER_SAFE_DATA);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ data: user });
  } catch (err) {
    return res.status(500).json({ message: err?.message || "Request failed" });
  }
});
module.exports = userRouter;
