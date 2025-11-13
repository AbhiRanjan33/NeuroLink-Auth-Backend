// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONNECT TO MONGO DB
mongoose.connect(
  'mongodb+srv://ranjanabhi2468_db_user:5IkHfpx60WlHYRQa@cluster0.xc3da1w.mongodb.net/neurolink?retryWrites=true&w=majority'
)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// USER SCHEMA
const userSchema = new mongoose.Schema({
  fingerprintId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, unique: true },
  name: String,
  email: String,
});

const User = mongoose.model('User', userSchema);

// AUTH: Check or create user
app.post('/auth', async (req, res) => {
  const { fingerprintId } = req.body;
  try {
    let user = await User.findOne({ fingerprintId });
    if (user) {
      return res.json({
        success: true,
        user: { name: user.name, email: user.email, userId: user.userId }
      });
    }

    const userId = `user_${fingerprintId}`;
    user = new User({ fingerprintId, userId });
    await user.save();

    res.json({ success: true, newUser: true, userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE PROFILE — FIXED: RETURN UPDATED USER
app.post('/save-profile', async (req, res) => {
  const { fingerprintId, name, email } = req.body;
  try {
    const updatedUser = await User.findOneAndUpdate(
      { fingerprintId },
      { name, email },
      { new: true }
    );

    // RETURN THE FULL USER SO FRONTEND CAN SHOW NAME/EMAIL
    res.json({
      success: true,
      user: {
        name: updatedUser.name,
        email: updatedUser.email,
        userId: updatedUser.userId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// TEST ROUTE
app.get('/', (req, res) => {
  res.send('NeuroLink Backend Running!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});