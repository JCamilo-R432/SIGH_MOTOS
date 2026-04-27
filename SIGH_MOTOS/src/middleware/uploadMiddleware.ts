/**
 * Multer middleware for file uploads.
 * Install if missing: npm install multer @types/multer
 */
import path from 'path'
import fs from 'fs'
import multer, { FileFilterCallback } from 'multer'
import type { Request } from 'express'

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads')

// ── Disk storage — organize by entity ────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const entityId = req.params.id ?? 'unknown'
    const dir = path.join(UPLOADS_DIR, 'products')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req: Request, file, cb) => {
    const entityId = req.params.id ?? Date.now().toString()
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    cb(null, `${entityId}${ext}`)
  },
})

// ── File filter — only images ──────────────────────────────────────────────
const imageFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  if (allowed.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Tipo de archivo no permitido. Use: JPG, PNG o WebP.'))
  }
}

export const uploadProductImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('image')
