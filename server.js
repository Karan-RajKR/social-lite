const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'social-lite-secret-key', // In production, use env var
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Helper: Get current user from session
const getCurrentUser = (req) => req.session.user;

// --- Auth Routes ---

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            req.session.user = { id: this.lastID, username };
            res.json({ message: 'Registered successfully', user: req.session.user });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.user = { id: user.id, username: user.username };
            res.json({ message: 'Logged in', user: req.session.user });
        } else {
            res.status(400).json({ error: 'Invalid credentials' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// --- Post Routes ---

app.get('/api/posts', (req, res) => {
    const currentUserId = req.session.user ? req.session.user.id : 0;

    // Get posts from self and followed users, or all posts if just exploring (simplified for "mini" app: get all posts)
    // Enhanced query to include like counts and if current user liked it
    const query = `
        SELECT 
            p.*, 
            u.username, 
            u.avatar,
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
            EXISTS (SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
    `;

    db.all(query, [currentUserId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/posts', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    db.run('INSERT INTO posts (user_id, content) VALUES (?, ?)', [req.session.user.id, content], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        // Return the created post with user info
        db.get(`
            SELECT p.*, u.username, u.avatar 
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.id = ?`, [this.lastID], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(row);
        });
    });
});

app.post('/api/posts/:id/like', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const postId = req.params.id;
    const userId = req.session.user.id;

    // Check if already liked
    db.get('SELECT * FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            // Unlike
            db.run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ liked: false });
            });
        } else {
            // Like
            db.run('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ liked: true });
            });
        }
    });
});

app.get('/api/posts/:id/comments', (req, res) => {
    const postId = req.params.id;
    db.all(`
        SELECT c.*, u.username, u.avatar 
        FROM comments c 
        JOIN users u ON c.user_id = u.id 
        WHERE c.post_id = ? 
        ORDER BY c.created_at ASC`, [postId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/posts/:id/comments', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const postId = req.params.id;
    const { content } = req.body;

    db.run('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)', [postId, req.session.user.id, content], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        db.get(`
            SELECT c.*, u.username, u.avatar 
            FROM comments c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.id = ?`, [this.lastID], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(row);
        });
    });
});

// --- User Routes ---

app.get('/api/users/:username', (req, res) => {
    const targetUsername = req.params.username;
    const currentUserId = req.session.user ? req.session.user.id : 0;

    db.get('SELECT id, username, bio, avatar, created_at FROM users WHERE username = ?', [targetUsername], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Get stats
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM posts WHERE user_id = ?) as post_count,
                (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following_count,
                (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers_count,
                EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?) as is_following
        `;

        db.get(statsQuery, [user.id, user.id, user.id, currentUserId, user.id], (err, stats) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ...user, ...stats });
        });
    });
});

app.get('/api/users/:username/posts', (req, res) => {
    const targetUsername = req.params.username;
    const currentUserId = req.session.user ? req.session.user.id : 0;

    db.get('SELECT id FROM users WHERE username = ?', [targetUsername], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const query = `
            SELECT 
                p.*, 
                u.username, 
                u.avatar,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
                (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
                EXISTS (SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC
        `;

        db.all(query, [currentUserId, user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

app.post('/api/users/:username/follow', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const targetUsername = req.params.username;
    const followerId = req.session.user.id;

    db.get('SELECT id FROM users WHERE username = ?', [targetUsername], (err, targetUser) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (targetUser.id === followerId) return res.status(400).json({ error: 'Cannot follow yourself' });

        const followingId = targetUser.id;

        db.get('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?', [followerId, followingId], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (row) {
                // Unfollow
                db.run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [followerId, followingId], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ following: false });
                });
            } else {
                // Follow
                db.run('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [followerId, followingId], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ following: true });
                });
            }
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
