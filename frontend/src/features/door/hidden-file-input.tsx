// The hidden file `<input>` behind the composer's `+` button. Rendered ONCE in a stable parent that
// survives the door→territory morph (DoorPage / RightPanel) — NOT inside ChatColumn, which unmounts
// and remounts at the morph and would detach the ref, silently breaking the `+`. `pickFiles`
// (use-intake.ts) clicks this via the shared `fileInputRef`.

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
