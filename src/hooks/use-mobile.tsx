"use client"

import { useMediaQuery } from "@/hooks/use-media-query"

export function useIsMobile(): boolean {
  // Tailwind's md breakpoint: 768px. Treat <768 as mobile
  const isBelowMd = useMediaQuery("(max-width: 767px)")
  return isBelowMd
}

export default useIsMobile


