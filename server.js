// backend/server.js
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const fetch=require('node-fetch');

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  fingerprintId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, unique: true },
  name: String,
  email: { type: String, unique: true, sparse: true },
  journals: [{
    text: String,
    mediaUrl: String,
    caption: String,
    timestamp: { type: Date, default: Date.now },
  }],
});

const User = mongoose.model('User', userSchema);

// AUTH
app.post('/auth', async (req, res) => {
  const { fingerprintId } = req.body;
  try {
    let user = await User.findOne({ fingerprintId });
    if (user) {
      return res.json({
        success: true,
        user: {
          name: user.name,
          email: user.email,
          userId: user.userId,
          fingerprintId: user.fingerprintId,
          journals: user.journals,
        },
      });
    }

    const userId = `user_${fingerprintId}`;
    user = new User({ fingerprintId, userId });
    await user.save();

    res.json({ success: true, newUser: true, userId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Fingerprint already registered' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE PROFILE
app.post('/save-profile', async (req, res) => {
  const { fingerprintId, name, email } = req.body;
  try {
    const existing = await User.findOne({ email, fingerprintId: { $ne: fingerprintId } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    const updated = await User.findOneAndUpdate(
      { fingerprintId },
      { name, email },
      { new: true }
    );

    res.json({
      success: true,
      user: {
        name: updated.name,
        email: updated.email,
        userId: updated.userId,
        fingerprintId: updated.fingerprintId,
        journals: updated.journals,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE JOURNAL (mediaUrl comes from frontend Cloudinary upload)
app.post('/save-journal', async (req, res) => {
  const { userId, text, mediaUrl, caption } = req.body;

  try {
    const journalEntry = {
      text: text || '',
      timestamp: new Date(),
    };

    if (mediaUrl) {
      journalEntry.mediaUrl = mediaUrl;
      journalEntry.caption = caption || '';
    }

    const user = await User.findOneAndUpdate(
      { userId },
      { $push: { journals: journalEntry } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      journals: user.journals,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



// Health Check
app.get('/', (req, res) => res.send('NeuroLink Backend OK'));

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});