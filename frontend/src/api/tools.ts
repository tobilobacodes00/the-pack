import { z } from 'zod'
import { api } from './client'

/** POST /parse — a file (pdf/csv/md/text/image/video) or URL → plain text the pack can research.
 *  Matches backend ParsedDocResponse. */
export const ParsedDocSchema = z.object({
  kind: z.string(),
  text: z.string(),
  chars: z.number(),
  filename: z.string().nullable().optional(),
})
export type ParsedDoc = z.infer<typeof ParsedDocSchema>

/** POST /transcribe — audio (or a video's audio track) → text. Matches backend TranscriptResponse. */
export const TranscriptSchema = z.object({
  text: z.string(),
  provider: z.string(),
  duration_s: z.number(),
})
export type Transcript = z.infer<typeof TranscriptSchema>

const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac|opus|weba)$/i

/** True for a filename the backend routes to /transcribe rather than /parse. Video is handled by
 *  /parse (it extracts + transcribes the audio track server-side), so only pure-audio goes here. */
export function isAudioFile(name: string): boolean {
  return AUDIO_RE.test(name)
}

/** Turn one attached file into plain text: audio → /transcribe, everything else → /parse. Returns the
 *  extracted text (empty string if the file yielded nothing). Throws on a network/parse failure so the
 *  caller can decide how to degrade — never silently pretend a file was read. */
export async function extractFileText(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const cfg = { headers: { 'Content-Type': 'multipart/form-data' } }
  if (isAudioFile(file.name)) {
    const res = await api.post('/transcribe', form, cfg)
    return TranscriptSchema.parse(res.data).text.trim()
  }
  const res = await api.post('/parse', form, cfg)
  return ParsedDocSchema.parse(res.data).text.trim()
}
