import { useEffect } from 'react'

let activeGuards = 0

function onBeforeUnload(e) {
  e.preventDefault()
  e.returnValue = ''
}

/**
 * Tampilkan peringatan browser saat refresh/tutup tab selama `active` true.
 * Aman dipakai di banyak komponen sekaligus (listener dipasang sekali).
 */
export function useUnloadGuard(active = true) {
  useEffect(() => {
    if (!active) return undefined
    if (activeGuards++ === 0) window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      if (--activeGuards === 0) window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [active])
}
