import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'

const tourSteps = [
  {
    id: 'search',
    dataTour: 'search',
    title: 'Search Your Music',
    description: 'Find any track, artist, album, or genre instantly.',
  },
  {
    id: 'library',
    dataTour: 'library',
    title: 'Browse Your Library',
    description: 'View all your albums, artists, and tracks organized.',
  },
  {
    id: 'downloader',
    dataTour: 'downloader',
    title: 'Download Music',
    description: 'Get music from YouTube using the built-in downloader.',
  },
  {
    id: 'settings',
    dataTour: 'settings',
    title: 'Customize Settings',
    description: 'Adjust themes, audio settings, and external tools.',
  }
]

export default function PostOnboardingTour() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const [highlightStyle, setHighlightStyle] = useState({})
  const tourRef = useRef(null)

  useEffect(() => {
    const shouldShowTour = localStorage.getItem('lokal-post-onboarding-tour-shown')
    if (!shouldShowTour) {
      const timer = setTimeout(() => {
        setIsOpen(true)
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (isOpen && tourSteps[currentStep]) {
      updatePosition()
    }
  }, [isOpen, currentStep])

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('resize', updatePosition)
      return () => window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen])

  const updatePosition = () => {
    const step = tourSteps[currentStep]
    if (!step) return

    const targetEl = document.querySelector(`[data-tour="${step.dataTour}"]`)
    
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const sidebar = document.querySelector('aside')
      const sidebarRect = sidebar?.getBoundingClientRect()

      if (sidebarRect) {
        setHighlightStyle({
          position: 'fixed',
          top: rect.top,
          left: sidebarRect.left,
          width: rect.width,
          height: rect.height,
          borderRadius: '8px',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
          zIndex: 40,
          pointerEvents: 'none',
        })

        setTooltipPosition({
          top: rect.bottom + 12,
          left: sidebarRect.left + rect.width + 16,
        })
      }
    }
  }

  const handleComplete = () => {
    localStorage.setItem('lokal-post-onboarding-tour-shown', 'true')
    setIsOpen(false)
    setHighlightStyle({})
  }

  const handleSkip = () => {
    handleComplete()
  }

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  if (!isOpen) return null

  const step = tourSteps[currentStep]

  return (
    <>
      <div style={highlightStyle} />
      <AnimatePresence>
        <motion.div
          ref={tourRef}
          initial={{ opacity: 0, scale: 0.9, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -10 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            top: tooltipPosition.top,
            left: tooltipPosition.left,
            zIndex: 50,
            maxWidth: '280px',
          }}
          className="bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-accent/10 border-b border-border">
            <span className="text-xs font-medium text-accent uppercase tracking-wider">Quick Tour</span>
            <button
              onClick={handleSkip}
              className="text-muted hover:text-white transition-colors p-1"
            >
              <X size={14} />
            </button>
          </div>

          <div className="p-4">
            <h3 className="text-base font-bold text-white mb-1">{step.title}</h3>
            <p className="text-xs text-muted mb-3">{step.description}</p>

            <div className="flex items-center gap-2 mb-3">
              {tourSteps.map((s, i) => (
                <div
                  key={s.id}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= currentStep ? 'bg-accent' : 'bg-border'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={handlePrev}
                  className="flex-1 py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-1"
                >
                  <ChevronLeft size={14} />
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className={`py-2 bg-accent rounded-xl text-xs font-medium text-white hover:bg-accent/80 transition-colors flex items-center justify-center gap-1 ${
                  currentStep === 0 ? 'flex-1' : 'flex-[2]'
                }`}
              >
                {currentStep < tourSteps.length - 1 ? (
                  <>
                    Next
                    <ChevronRight size={14} />
                  </>
                ) : (
                  'Got it!'
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  )
}

export function resetPostOnboardingTour() {
  localStorage.removeItem('lokal-post-onboarding-tour-shown')
}

