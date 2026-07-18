// Rendered once in a stable parent that survives the door→territory morph — not inside ChatColumn,
// which remounts at the morph and would detach the ref, silently breaking the `+`.

/** The file types the pack can absorb — docs for research context, audio for transcription. */
const ACCEPT = '.pdf,.csv,.txt,.md,.docx,.mp3,.wav,.ogg,.aac,.flac,.m4a'

export function HiddenFileInput({
  inputRef,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement>
  onFiles: (files: FileList | File[]) => void
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      accept={ACCEPT}
      onChange={(e) => {
        if (e.target.files) onFiles(e.target.files)
        e.target.value = '' // allow re-picking the same file
      }}
    />
  )
}
