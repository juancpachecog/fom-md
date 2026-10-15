import { lazy, Suspense, useLayoutEffect } from 'react'
import CargaFom from './components/CargaFom'
import { Routes, Route, useLocation } from 'react-router-dom'
import MarketingHeader from './components/marketing/MarketingChrome'
import './styles/marketing.css'
import './styles/marketing-backgrounds.css'
import './styles/fom-v6.css'
import './styles/v7-header.css'

const Marketing = lazy(() => import('./pages/ReferenceMarketing'))
const Inicio = lazy(() => import('./pages/v7/Inicio'))
// v7 pages, one per route, implemented from output/laminas-secciones-v7.
const V7_PAGES = {
  plataforma: lazy(() => import('./pages/v7/Plataforma')),
  app: lazy(() => import('./pages/v7/AppConductor')),
  funciones: lazy(() => import('./pages/v7/Funciones')),
  seguridad: lazy(() => import('./pages/v7/Seguridad')),
  areas: lazy(() => import('./pages/v7/Areas')),
  'quienes-somos': lazy(() => import('./pages/v7/QuienesSomos')),
  'que-ofrecemos': lazy(() => import('./pages/v7/QueOfrecemos')),
  beneficios: lazy(() => import('./pages/v7/Beneficios')),
  'preguntas-frecuentes': lazy(() => import('./pages/v7/Preguntas')),
  contacto: lazy(() => import('./pages/v7/Contacto')),
}
const Entrar = lazy(() => import('./pages/Entrar'))
const CambiarClaveInicial = lazy(() => import('./pages/CambiarClaveInicial'))
const Consola = lazy(() => import('./panel/Consola'))
const MotionPage = lazy(() => import('./motion/MotionPage'))
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'

function ScrollTop() {
  const { pathname, hash } = useLocation()
  useLayoutEffect(() => {
    if (!hash) { window.scrollTo({ top: 0, behavior: 'instant' }); return }
    // Route chunks may arrive after this effect; observe only until the anchor exists.
    let targetId
    try { targetId = decodeURIComponent(hash.slice(1)) } catch { return }
    const jump = () => {
      const target = document.getElementById(targetId)
      if (!target) return false
      target.scrollIntoView({ block: 'start', behavior: 'instant' })
      return true
    }
    if (jump()) return
    const observer = new MutationObserver(() => { if (jump()) observer.disconnect() })
    observer.observe(document.getElementById('root'), { childList: true, subtree: true })
    const timeout = setTimeout(() => observer.disconnect(), 5000)
    return () => { observer.disconnect(); clearTimeout(timeout) }
  }, [pathname, hash])
  return null
}

export default function App() {
  const { pathname } = useLocation()
  const esConsola = pathname === '/motion' || pathname === '/entrar' || pathname === '/cambiar-clave-inicial' || pathname.startsWith('/panel')
  const v7 = pathname === '/' || Boolean(V7_PAGES[pathname.slice(1)])
  return <div id="top" className={esConsola ? undefined : `marketing-v2${v7 ? ' v7-shell' : ''}`}>
    <a className="skip-link" href="#contenido">Saltar al contenido</a>
    {!esConsola && <MarketingHeader />}
    <ScrollTop />
    <Suspense fallback={<CargaFom />}>
      <Routes>
        <Route path="/" element={<Inicio />} />
        {['plataforma','funciones','seguridad','areas','contacto','preguntas-frecuentes','app','beneficios','quienes-somos','que-ofrecemos'].map(path => {
          const Page = V7_PAGES[path] || Marketing
          return <Route key={path} path={'/' + path} element={<Page />} />
        })}
        <Route path="/motion" element={<MotionPage />} />
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/cambiar-clave-inicial" element={<CambiarClaveInicial />} />
        <Route path="/panel/*" element={<Consola />} />
        <Route path="*" element={<Marketing />} />
      </Routes>
    </Suspense>
  </div>
}
