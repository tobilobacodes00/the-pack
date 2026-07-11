export function FileDropOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(10,10,10,0.88)' }}
    >
      <img
        src="/icon-file-drop.svg"
        className="opacity-40"
        style={{ width: 96, height: 120 }}
        alt=""
      />
      <p className="text-white text-xl font-medium tracking-wide">
        Drop files here to add to chat
      </p>
    </div>
  )
}
