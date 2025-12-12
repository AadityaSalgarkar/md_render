#!/usr/bin/env node
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 3333
const DIST_DIR = path.join(__dirname, 'dist')

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  // API endpoint to serve markdown files
  if (url.pathname === '/api/file') {
    const filePath = url.searchParams.get('path')
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing path parameter')
      return
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(filePath)

    fs.readFile(absolutePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('File not found: ' + absolutePath)
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(data)
    })
    return
  }

  // Serve static files from dist
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname
  const fullPath = path.join(DIST_DIR, filePath)

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(DIST_DIR, 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(data2)
      })
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`MD Render server running at http://localhost:${PORT}`)
})
