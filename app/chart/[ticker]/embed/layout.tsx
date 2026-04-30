export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { background: #080807; width: 100%; height: 100%; overflow: hidden; }
        `}</style>
      </head>
      <body style={{ width: '100%', height: '100%' }}>{children}</body>
    </html>
  )
}
