import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import { useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'

function App() {
  const [reports, setReports] = useState([])
  const [error, setError] = useState('')
  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

  const mapCenter = useMemo(() => {
    if (reports.length === 0) {
      return [20, 0]
    }
    const first = reports[0]
    return [first.location.latitude, first.location.longitude]
  }, [reports])

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const response = await fetch(`${apiUrl}/reports`)
        if (!response.ok) {
          throw new Error('Failed to fetch reports')
        }
        const payload = await response.json()
        setReports(payload)
        setError('')
      } catch (err) {
        setError(err.message)
      }
    }

    fetchReports()
    const interval = setInterval(fetchReports, 5000)
    return () => clearInterval(interval)
  }, [apiUrl])

  const markerStyle = (score) => {
    if (score >= 70) {
      return { color: '#dc2626', fillColor: '#dc2626' }
    }
    if (score >= 40) {
      return { color: '#f59e0b', fillColor: '#f59e0b' }
    }
    return { color: '#16a34a', fillColor: '#16a34a' }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-slate-950 text-slate-100 md:grid-cols-[2fr_1fr]">
      <section className="relative">
        <MapContainer center={mapCenter} zoom={2} className="h-screen w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {reports.map((report) => {
            const style = markerStyle(report.urgency_score)
            return (
              <CircleMarker
                key={report.id}
                center={[report.location.latitude, report.location.longitude]}
                radius={10}
                color={style.color}
                fillColor={style.fillColor}
                fillOpacity={0.85}
              >
                <Popup>
                  <p className="font-semibold">{report.priority_level.toUpperCase()} priority</p>
                  <p>{report.transcription}</p>
                  <p className="text-sm">Score: {report.urgency_score}</p>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </section>

      <aside className="h-screen overflow-y-auto border-l border-slate-800 p-4">
        <h1 className="text-xl font-bold">Crisis Sentinel Dashboard</h1>
        <p className="mt-1 text-sm text-slate-300">Live emergency reports feed</p>
        {error ? (
          <p className="mt-4 rounded bg-red-500/20 p-3 text-sm text-red-200">{error}</p>
        ) : null}
        <div className="mt-4 space-y-3">
          {reports.map((report) => (
            <article key={report.id} className="rounded border border-slate-700 bg-slate-900 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold uppercase tracking-wide">
                  {report.priority_level}
                </span>
                <span className="text-sm">Score: {report.urgency_score}</span>
              </div>
              <p className="mt-2 text-sm text-slate-200">{report.transcription}</p>
              <p className="mt-2 text-xs text-slate-400">
                {report.report_type} • {report.location.latitude.toFixed(3)},
                {report.location.longitude.toFixed(3)}
              </p>
            </article>
          ))}
          {reports.length === 0 && !error ? (
            <p className="rounded border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">
              No active reports yet. Start the simulator to generate sample incidents.
            </p>
          ) : null}
        </div>
      </aside>
    </main>
  )
}

export default App
