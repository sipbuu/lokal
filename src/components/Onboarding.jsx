import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Music, FolderOpen, Disc3, Sparkles, ChevronRight, SkipForward, Play, Check, User, AlertCircle, Download, Settings, Zap, Palette } from 'lucide-react'
import { api } from '../api'
import { useAppStore } from '../store/player'
import { THEMES, applyTheme } from '../theme'

const steps = [
  {
    id: 'welcome',
    title: 'Welcome to Lokal',
    description: 'Your personal local-first music player. Enjoy your entire music library without the burden of streaming subscriptions.',
    icon: Music,
  },
  {
    id: 'local-only',
    title: 'Important: Local Music Only',
    description: 'Lokal is NOT a streaming service. You need to either: (1) Download music using the built-in YouTube downloader, or (2) Import your existing music files from a folder on your computer.',
    icon: AlertCircle,
  },
  {
    id: 'folder',
    title: 'Select Your Music Folder',
    description: 'Choose a folder where your music files are stored. Lokal will scan and organize your library.',
    icon: FolderOpen,
  },
  {
    id: 'tools',
    title: 'Download Tools (Optional)',
    description: 'To download music from YouTube, you need yt-dlp and ffmpeg. You can download them now or later from Settings.',
    icon: Zap,
    isElectron: true,
  },
  {
    id: 'user',
    title: 'Create Account (Optional)',
    description: 'You can skip this, your data is stored under a guest account if you do. Create an account if you just want the looks of it.',
    icon: User,
  },
  {
    id: 'scan',
    title: 'Scan Your Library',
    description: 'Ready to scan your music folder and discover your tracks?',
    icon: Disc3,
  },
  {
    id: 'complete',
    title: 'All Set!',
    description: 'Your music library is ready. Enjoy your music with Lokal!',
    icon: Sparkles,
  },
]

export default function Onboarding({ isOpen, onComplete }) {
  const [currentStep, setCurrentStep] = useState(0)
  const [musicFolder, setMusicFolder] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, isActive: false })
  const [toolsStatus, setToolsStatus] = useState(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [showUserForm, setShowUserForm] = useState(false)
  const [userForm, setUserForm] = useState({ username: '', password: '', email: '' })
  const [userError, setUserError] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)
  const [settings, setSettings] = useState({})
  
  const { openAuth } = useAppStore()
  const scanProgressRef = useRef(null)

  const updateSetting = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }))
  }

  useEffect(() => {
    if (isOpen) {
      api.getSettings().then(s => {
        if (s?.music_folder) {
          setMusicFolder(s.music_folder)
        }
        if (s) {
          setSettings({
            fetch_online_artwork: s.fetch_online_artwork || '1',
            index_while_downloading: s.index_while_downloading || '1',
            auto_fetch_genres: s.auto_fetch_genres || '1',
            skip_drumkit_pattern: s.skip_drumkit_pattern !== '0' ? '1' : '0',
            theme: s.theme || 'dark',
            min_duration: s.min_duration || '60'
          })
        }
      })
      
      if (api.isElectron) {
        api.getToolsStatus().then(setToolsStatus)
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const unsubscribe = api.onScanProgress((progress) => {
      if (progress) {
        setScanProgress({
          current: progress.current || 0,
          total: progress.total || 0,
          isActive: true
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [isOpen])

  const handleSelectFolder = async () => {
    const folder = await api.openFolder()
    if (folder) {
      setMusicFolder(folder)
      await api.saveSettings({ music_folder: folder })
    }
  }

  const handleSkip = async () => {
    localStorage.setItem('lokal-onboarding-complete', 'true')
    onComplete()
  }

  const handleScan = async () => {
    if (!musicFolder) {
      const folder = await api.openFolder()
      if (folder) {
        setMusicFolder(folder)
        await api.saveSettings({ music_folder: folder })
        await performScan(folder)
      }
      return
    }
    await performScan(musicFolder)
  }

  const performScan = async (folder) => {
    setIsScanning(true)
    setScanning(true)
    setScanProgress({ current: 0, total: 0, isActive: true })
    try {
      await api.scanFolder(folder)
      setScanProgress({ current: 0, total: 0, isActive: false })
      setCurrentStep(6) 
    } catch (e) {
      console.error('Scan error:', e)
      setScanProgress({ current: 0, total: 0, isActive: false })
    } finally {
      setScanning(false)
      setIsScanning(false)
    }
  }

  const handleGetStarted = () => {
    if (settings.theme) {
      const selectedTheme = THEMES[settings.theme]
      if (selectedTheme) {
        applyTheme(selectedTheme.vars)
      }
    }
    localStorage.setItem('lokal-onboarding-complete', 'true')
    onComplete()
  }

  const handleNext = async () => {
    if (currentStep === 2 && Object.keys(settings).length > 0) {
      await api.saveSettings(settings)
      if (settings.theme) {
        const selectedTheme = THEMES[settings.theme]
        if (selectedTheme) {
          applyTheme(selectedTheme.vars)
        }
      }
    }
    if (currentStep < steps.length - 1) {
      if (steps[currentStep + 1].isElectron && !api.isElectron) {
        setCurrentStep(currentStep + 2)
        return
      }
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      if (currentStep > 1 && steps[currentStep - 1].isElectron && !api.isElectron) {
        setCurrentStep(currentStep - 2)
        return
      }
      setCurrentStep(currentStep - 1)
    }
  }

  const downloadYtDlp = async () => {
    setToolsLoading(true)
    try {
      await api.downloadYtDlp()
      await api.getToolsStatus().then(setToolsStatus)
    } catch (e) {
      console.error('Download yt-dlp error:', e)
    }
    setToolsLoading(false)
  }

  const downloadFfmpeg = async () => {
    setToolsLoading(true)
    try {
      await api.downloadFfmpeg()
      await api.getToolsStatus().then(setToolsStatus)
    } catch (e) {
      console.error('Download ffmpeg error:', e)
    }
    setToolsLoading(false)
  }

  const handleCreateUser = async () => {
    if (!userForm.username || !userForm.password) {
      setUserError('Username and password are required')
      return
    }
    
    setCreatingUser(true)
    setUserError('')
    
    try {
      const result = await api.register({
        username: userForm.username,
        password: userForm.password,
        email: userForm.email || undefined
      })
      
      if (result.error) {
        setUserError(result.error)
      } else {
        handleNext()
      }
    } catch (e) {
      setUserError(e.message)
    } finally {
      setCreatingUser(false)
    }
  }

  const handleSkipUser = () => {
    handleNext()
  }

  if (!isOpen) return null

  const step = steps[currentStep]
  const StepIcon = step.icon

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-elevated border border-border rounded-3xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        >
          <div className="flex items-center gap-1.5 p-4 pb-0">
            {steps.filter(s => !s.isElectron || api.isElectron).map((s, i) => {
               const actualIndex = steps.findIndex(st => st.id === s.id)
              return (
                <div
                  key={s.id}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    actualIndex <= currentStep ? 'bg-accent' : 'bg-border'
                  }`}
                />
              )
            })}
          </div>

          <div className="p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex justify-center mb-6">
                  <div className="p-4 bg-accent/20 rounded-2xl">
                    <StepIcon size={40} className="text-accent" />
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-white text-center mb-3">
                  {step.title}
                </h2>

                <p className="text-muted text-center text-sm leading-relaxed mb-8">
                  {step.description}
                </p>

                {step.id === 'local-only' && (
                  <div className="space-y-3">
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div className="space-y-2 text-xs text-yellow-200/80">
                          <p><strong>NOT a streaming service!</strong></p>
                          <p>Lokal doesn't have any built-in music. You must:</p>
                          <ul className="list-disc list-inside space-y-1 ml-1">
                            <li>Download music using the Downloader (requires yt-dlp)</li>
                            <li>OR import music files from a folder on your computer</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {step.id === 'folder' && (
                  <div className="space-y-4">
                    <div
                      onClick={handleSelectFolder}
                      className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-all group"
                    >
                      {musicFolder ? (
                        <div className="space-y-2">
                          <FolderOpen size={24} className="mx-auto text-accent" />
                          <p className="text-sm text-white truncate px-4">{musicFolder}</p>
                          <p className="text-xs text-muted">Click to change folder</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <FolderOpen size={24} className="mx-auto text-muted group-hover:text-accent transition-colors" />
                          <p className="text-sm text-muted group-hover:text-white transition-colors">Click to select your music folder</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="bg-card/50 rounded-xl p-4 space-y-3">
                      <p className="text-xs text-muted font-medium">Quick Settings</p>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white">Fetch Online Artwork</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateSetting('fetch_online_artwork', settings.fetch_online_artwork === '0' ? '1' : '0') }}
                          className={`px-3 py-1 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.fetch_online_artwork !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}
                        >
                          {settings.fetch_online_artwork !== '0' ? 'On' : 'Off'}
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white">Index While Downloading</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateSetting('index_while_downloading', settings.index_while_downloading === '1' ? '0' : '1') }}
                          className={`px-3 py-1 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.index_while_downloading === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}
                        >
                          {settings.index_while_downloading === '1' ? 'On' : 'Off'}
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white">Auto-fetch Genres</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateSetting('auto_fetch_genres', settings.auto_fetch_genres === '0' ? '1' : '0') }}
                          className={`px-3 py-1 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.auto_fetch_genres !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}
                        >
                          {settings.auto_fetch_genres !== '0' ? 'On' : 'Off'}
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white">Skip Drum-kit Pattern</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateSetting('skip_drumkit_pattern', settings.skip_drumkit_pattern === '0' ? '1' : '0') }}
                          className={`px-3 py-1 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.skip_drumkit_pattern !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}
                        >
                          {settings.skip_drumkit_pattern !== '0' ? 'On' : 'Off'}
                        </button>
                      </div>
                    </div>
                    
                    <div className="bg-card/50 rounded-xl p-4 space-y-3">
                      <p className="text-xs text-muted font-medium flex items-center gap-2">
                        <Palette size={14} /> Theme
                      </p>
                      <div className="grid grid-cols-5 gap-2">
                        {Object.entries(THEMES).slice(0, 5).map(([key, theme]) => (
                          <button
                            key={key}
                            onClick={(e) => { e.stopPropagation(); updateSetting('theme', key) }}
                            className={`p-2 rounded-lg border transition-all ${settings.theme === key || (!settings.theme && key === 'dark') ? 'bg-accent/20 border-accent/50' : 'bg-card border-border hover:border-accent/30'}`}
                          >
                            <div className="flex flex-col gap-1">
                              <div className="flex gap-0.5">
                                <div className="w-3 h-3 rounded" style={{ background: theme.vars['--bg'] }} />
                                <div className="w-3 h-3 rounded" style={{ background: theme.vars['--surface'] }} />
                                <div className="w-3 h-3 rounded" style={{ background: theme.vars['--accent'] }} />
                              </div>
                              <span className={`text-[8px] ${settings.theme === key || (!settings.theme && key === 'dark') ? 'text-accent' : 'text-muted'}`}>
                                {theme.name}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {step.id === 'tools' && api.isElectron && (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      {/* yt-dlp */}
                      <div className="flex items-center justify-between bg-card/50 rounded-xl p-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${toolsStatus?.ytdlp?.found ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span className="text-sm text-white">yt-dlp</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {toolsStatus?.ytdlp?.found ? (
                            <span className="text-xs text-green-400">Installed</span>
                          ) : (
                            <button
                              onClick={downloadYtDlp}
                              disabled={toolsLoading}
                              className="px-3 py-1.5 bg-accent/20 border border-accent/30 text-accent rounded-lg text-xs hover:bg-accent/30 transition-colors disabled:opacity-40"
                            >
                              {toolsLoading ? 'Downloading...' : 'Download'}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ffmpeg */}
                      <div className="flex items-center justify-between bg-card/50 rounded-xl p-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${toolsStatus?.ffmpeg?.found ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span className="text-sm text-white">ffmpeg</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {toolsStatus?.ffmpeg?.found ? (
                            <span className="text-xs text-green-400">Installed</span>
                          ) : (
                            <button
                              onClick={downloadFfmpeg}
                              disabled={toolsLoading}
                              className="px-3 py-1.5 bg-accent/20 border border-accent/30 text-accent rounded-lg text-xs hover:bg-accent/30 transition-colors disabled:opacity-40"
                            >
                              {toolsLoading ? 'Downloading...' : 'Download'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted text-center">
                      You can also download these later from Settings → External Tools
                    </p>
                  </div>
                )}

                {step.id === 'user' && (
                  <div className="space-y-4">
                    <div className="bg-card/50 rounded-xl p-4 space-y-3">
                      <p className="text-xs text-muted">
                        This feature originally existed for the original span of the project while it was server-based.
                        Now that it's local-first, you can skip this, all your data is stored on this device.
                      </p>
                      
                      {!showUserForm ? (
                        <button
                          onClick={() => setShowUserForm(true)}
                          className="w-full py-2.5 bg-accent/20 border border-accent/30 text-accent rounded-xl text-sm font-medium hover:bg-accent/30 transition-colors"
                        >
                          Create Account (Optional)
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <input
                            type="text"
                            placeholder="Username"
                            value={userForm.username}
                            onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                            className="w-full px-3 py-2 bg-card border border-border rounded-xl text-sm text-white placeholder:text-muted focus:outline-none focus:border-accent"
                          />
                          <input
                            type="email"
                            placeholder="Email (optional)"
                            value={userForm.email}
                            onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                            className="w-full px-3 py-2 bg-card border border-border rounded-xl text-sm text-white placeholder:text-muted focus:outline-none focus:border-accent"
                          />
                          <input
                            type="password"
                            placeholder="Password"
                            value={userForm.password}
                            onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                            className="w-full px-3 py-2 bg-card border border-border rounded-xl text-sm text-white placeholder:text-muted focus:outline-none focus:border-accent"
                          />
                          {userError && <p className="text-xs text-red-400">{userError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={handleCreateUser}
                              disabled={creatingUser}
                              className="flex-1 py-2 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors disabled:opacity-40"
                            >
                              {creatingUser ? 'Creating...' : 'Create Account'}
                            </button>
                            <button
                              onClick={() => {
                                setShowUserForm(false)
                                setUserForm({ username: '', password: '', email: '' })
                                setUserError('')
                              }}
                              className="px-4 py-2 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {step.id === 'scan' && (
                  <div className="space-y-4">
                    {scanning ? (
                      <div className="text-center space-y-4">
                        <div className="relative">
                          <Disc3 size={48} className="mx-auto text-accent animate-spin" />
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm text-white">Scanning your music library...</p>
                          {scanProgress.isActive && scanProgress.total > 0 && (
                            <p className="text-xs text-muted">
                              {scanProgress.current} / {scanProgress.total} tracks
                            </p>
                          )}
                        </div>
                        <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                          <motion.div 
                            className="h-full bg-accent"
                            initial={{ width: 0 }}
                            animate={{ 
                              width: scanProgress.isActive && scanProgress.total > 0 
                                ? `${(scanProgress.current / scanProgress.total) * 100}%` 
                                : '0%' 
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="bg-card/50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <FolderOpen size={18} className="text-accent" />
                          <p className="text-sm text-white truncate">{musicFolder || 'No folder selected'}</p>
                        </div>
                        <p className="text-xs text-muted">
                          Your music folder is set. Ready to scan and discover your tracks!
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {step.id === 'complete' && (
                  <div className="text-center space-y-4">
                    <div className="p-4 bg-green-500/20 rounded-full inline-flex">
                      <Check size={40} className="text-green-400" />
                    </div>
                    <p className="text-sm text-muted">
                      Your library has been scanned and is ready to play!
                    </p>
                    <div className="bg-card/50 rounded-xl p-3 text-xs text-muted">
                      <p>Next steps:</p>
                      <ul className="list-disc list-inside mt-2 space-y-1">
                        <li>Use Downloader to get music from YouTube</li>
                        <li>Use the Player to play your tracks</li>
                        <li>Search for tracks, artists, albums, and genres</li>
                      </ul>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="px-8 pb-8">
            {currentStep === 0 && (
              <div className="flex gap-3">
                <button
                  onClick={handleSkip}
                  className="flex-1 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-2"
                >
                  <SkipForward size={16} />
                  Skip Setup
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                >
                  Get Started
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {currentStep === 1 && (
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-2"
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                >
                  I Understand
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {currentStep === 2 && (
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-2"
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  disabled={!musicFolder}
                  className="flex-1 py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continue
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {step.id === 'tools' && (
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-2"
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                >
                  {api.isElectron ? 'Continue' : 'Skip (Web Mode)'}
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {step.id === 'user' && (
              <div className="flex gap-3">
                <button
                  onClick={handleSkipUser}
                  className="flex-1 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-2"
                >
                  <SkipForward size={16} />
                  Skip (Use Locally)
                </button>
                <button
                  onClick={handleNext}
                  className="flex-1 py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                >
                  Continue
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {step.id === 'scan' && (
              <div className="flex gap-3">
                <button
                  onClick={handleGetStarted}
                  disabled={scanning}
                  className="flex-1 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <SkipForward size={16} />
                  Scan Later
                </button>
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="flex-1 py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {scanning ? (
                    <>
                      <Disc3 size={16} className="animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Scan Now
                    </>
                  )}
                </button>
              </div>
            )}

             {step.id === 'complete' && (
              <button
                onClick={handleGetStarted}
                className="w-full py-3 bg-accent rounded-xl text-sm font-medium text-white hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
              >
                <Check size={16} />
                Start Listening
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkOnboarding = async () => {
      const completed = localStorage.getItem('lokal-onboarding-complete')
      
      if (!completed) {
        try {
          const settings = await api.getSettings()
          if (!settings?.music_folder) {
            setShowOnboarding(true)
          }
        } catch (e) {
          setShowOnboarding(true)
        }
      }
      setLoading(false)
    }

    checkOnboarding()
  }, [])

  const completeOnboarding = () => {
    setShowOnboarding(false)
  }

  return { showOnboarding, completeOnboarding, loading }
}
