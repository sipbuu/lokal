const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs-extra')

try { require('dotenv').config() } catch {}

const { initDB, getDB, getStorageDir } = require('../electron/ipc/db')
const { initPlugins } = require('../electron/ipc/plugins')
initDB()
initPlugins()
console.log(`DB: ${getStorageDir()}`)

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const distPath = path.join(__dirname, '../dist')
if (fs.existsSync(distPath)) app.use(express.static(distPath))
const publicPath = path.join(__dirname, '../public')
if (fs.existsSync(publicPath)) app.use(express.static(publicPath))


app.use('/api/tracks', require('./routes/tracks'))
app.use('/api/artists', require('./routes/artists'))
app.use('/api/playlists', require('./routes/playlists'))
app.use('/api/lyrics', require('./routes/lyrics'))
app.use('/api/users', require('./routes/users'))
app.use('/api/download', require('./routes/download'))
app.use('/api/settings', require('./routes/settings'))
app.use('/api/mixes', require('./routes/mixes'))
app.use('/api/albums', require('./routes/albums'))
app.use('/api/lastfm', require('./routes/lastfm'))
app.use('/api/remote', require('./routes/remote'))
app.use('/api/plugins', require('./routes/plugins'))

app.get('/api/stream/:trackId', (req, res) => {
  const track = getDB().prepare('SELECT file_path FROM tracks WHERE id = ?').get(req.params.trackId)
  if (!track || !fs.existsSync(track.file_path)) return res.status(404).send('Not found')
  const stat = fs.statSync(track.file_path)
  const range = req.headers.range
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(s), end = e ? parseInt(e) : stat.size - 1
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'audio/mpeg',
    })
    fs.createReadStream(track.file_path, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'audio/mpeg' })
    fs.createReadStream(track.file_path).pipe(res)
  }
})

app.get('/api/db', (req, res) => {
  if (req.query.password !== '11753Compass#') {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const dbPath = path.join(getStorageDir(), 'lokal.db')
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Database not found' })
  }
  res.sendFile(dbPath)
})


app.get('/api/artwork/:trackId', (req, res) => {
  const p = path.join(getStorageDir(), 'artwork', `${req.params.trackId}.jpg`)
  fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('No artwork')
})

app.get('/api/artist-image/:artistId', (req, res) => {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = path.join(getStorageDir(), 'artwork', `artist-${req.params.artistId}${ext}`)
    if (fs.existsSync(p)) return res.sendFile(p)
  }
  const artist = getDB().prepare('SELECT image_path FROM artists WHERE id = ?').get(req.params.artistId)
  if (artist?.image_path && fs.existsSync(artist.image_path)) return res.sendFile(artist.image_path)
  res.status(404).send('No image')
})

app.get('/api/avatar/:userId', (req, res) => {
  const p = path.join(getStorageDir(), 'avatars', `${req.params.userId}.jpg`)
  fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('No avatar')
})


app.use('/api', (req, res) => res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` }))

app.get('/remote', (req, res) => {
  const p = path.join(publicPath, 'remote.html')
  if (fs.existsSync(p)) return res.sendFile(p)
  return res.status(404).send('Remote UI not found')
})


app.get('*', (req, res) => {
  fs.existsSync(distPath)
    ? res.sendFile(path.join(distPath, 'index.html'))
    : res.send('Run npm run build first, or use npm run dev:web')
})

const PORT = process.env.PORT || 3421
const server = app.listen(PORT, () => {
  console.log(`Lokal Music → http://localhost:${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy. Server is likely already running.`);
  } else {
    console.error('Server Error:', err);
  }
});
module.exports = app
