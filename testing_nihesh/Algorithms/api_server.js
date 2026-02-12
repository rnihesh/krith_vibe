const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const users = new Map();

app.get('/api/users', (req, res) => {
  res.json([...users.values()]);
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  const id = Date.now().toString();
  const user = { id, name, email, createdAt: new Date().toISOString() };
  users.set(id, user);
  res.status(201).json(user);
});

app.delete('/api/users/:id', (req, res) => {
  users.delete(req.params.id);
  res.status(204).end();
});

app.listen(3000, () => console.log('Server running on port 3000'));
