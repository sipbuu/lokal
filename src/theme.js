export const THEMES = {
  dark: {
    name: 'Dark',
    vars: {
      '--bg': '#0a0a0a',
      '--surface': '#111111',
      '--surface2': '#181818',
      '--surface3': '#202020',
      '--border': '#2a2a2a',
      '--border2': '#333333',
      '--text': '#e8e8e8',
      '--muted': '#888888',
      '--muted2': '#555555',
      '--accent': '#e8ff57',
      '--accent-dim': '#c8df47',
      '--red': '#ff5757',
      '--purple': '#7c6aff',
      '--orange': '#ff9f43',
      '--text-scale': '1',
      '--bg-image': 'none',
      '--bg-overlay': '0',
    }
  },
  light: {
    name: 'Light',
    vars: {
      '--bg': '#f5f5f5',
      '--surface': '#ffffff',
      '--surface2': '#fafafa',
      '--surface3': '#f0f0f0',
      '--border': '#e0e0e0',
      '--border2': '#cccccc',
      '--text': '#1a1a1a',
      '--muted': '#666666',
      '--muted2': '#999999',
      '--accent': '#7c6aff',
      '--accent-dim': '#9d94ff',
      '--red': '#e53935',
      '--purple': '#5e35b1',
      '--orange': '#fb8c00',
      '--text-scale': '1',
      '--bg-image': 'none',
      '--bg-overlay': '0',
    }
  },
  midnight: {
    name: 'Midnight',
    vars: {
      '--bg': '#0d1117',
      '--surface': '#161b22',
      '--surface2': '#21262d',
      '--surface3': '#30363d',
      '--border': '#30363d',
      '--border2': '#484f58',
      '--text': '#c9d1d9',
      '--muted': '#8b949e',
      '--muted2': '#6e7681',
      '--accent': '#58a6ff',
      '--accent-dim': '#388bfd',
      '--red': '#f85149',
      '--purple': '#a371f7',
      '--orange': '#d29922',
      '--text-scale': '1',
    }
  },
  warm: {
    name: 'Warm',
    vars: {
      '--bg': '#1a1410',
      '--surface': '#251c18',
      '--surface2': '#302520',
      '--surface3': '#3d2e28',
      '--border': '#4a3830',
      '--border2': '#5c4640',
      '--text': '#f0e6dc',
      '--muted': '#a89585',
      '--muted2': '#7d6b60',
      '--accent': '#ff9f43',
      '--accent-dim': '#e08a3a',
      '--red': '#e74c3c',
      '--purple': '#9b59b6',
      '--orange': '#e67e22',
      '--text-scale': '1',
    }
  },
  oled: {
    name: 'OLED',
    vars: {
      '--bg': '#000000',
      '--surface': '#0a0a0a',
      '--surface2': '#121212',
      '--surface3': '#1a1a1a',
      '--border': '#222222',
      '--border2': '#2a2a2a',
      '--text': '#ffffff',
      '--muted': '#888888',
      '--muted2': '#555555',
      '--accent': '#e8ff57',
      '--accent-dim': '#c8df47',
      '--red': '#ff5757',
      '--purple': '#7c6aff',
      '--orange': '#ff9f43',
      '--text-scale': '1',
    }
  },
  ocean: {
    name: 'Ocean',
    vars: {
      '--bg': '#0a1929',
      '--surface': '#0f2744',
      '--surface2': '#14395e',
      '--surface3': '#1a4678',
      '--border': '#1e4d6b',
      '--border2': '#2a5f7f',
      '--text': '#e0f0ff',
      '--muted': '#7aa3c4',
      '--muted2': '#5a7d9e',
      '--accent': '#57b8ff',
      '--accent-dim': '#4a9fe8',
      '--red': '#ff5757',
      '--purple': '#7c6aff',
      '--orange': '#ff9f43',
      '--text-scale': '1',
    }
  },
  forest: {
    name: 'Forest',
    vars: {
      '--bg': '#0a1a0a',
      '--surface': '#0f260f',
      '--surface2': '#143214',
      '--surface3': '#1a3d1a',
      '--border': '#1f451f',
      '--border2': '#2a552a',
      '--text': '#e0ffe0',
      '--muted': '#7ac47a',
      '--muted2': '#5a9a5a',
      '--accent': '#57ffd4',
      '--accent-dim': '#4ae8c0',
      '--red': '#ff5757',
      '--purple': '#7c6aff',
      '--orange': '#ff9f43',
      '--text-scale': '1',
    }
  },
  cyberpunk: {
    name: 'Cyberpunk',
    vars: {
      '--bg': '#0f0f1a',
      '--surface': '#161625',
      '--surface2': '#1c1c30',
      '--surface3': '#252540',
      '--border': '#2d2d4a',
      '--border2': '#3a3a5e',
      '--text': '#00ffcc', 
      '--muted': '#7a7ab0',
      '--muted2': '#4e4e7a',
      '--accent': '#ff00ff', 
      '--accent-dim': '#bc00bc',
      '--red': '#ff3e3e',
      '--purple': '#9d4edd',
      '--orange': '#ff9100',
      '--text-scale': '1',
    }
  },
  rosegold: {
    name: 'Rose Gold',
    vars: {
      '--bg': '#1a1718',
      '--surface': '#241e20',
      '--surface2': '#2d2528',
      '--surface3': '#382e32',
      '--border': '#45383c',
      '--border2': '#54454a',
      '--text': '#f5edee',
      '--muted': '#a69296',
      '--muted2': '#7a686c',
      '--accent': '#ffb7c5', 
      '--accent-dim': '#e5a4b1',
      '--red': '#ff6b6b',
      '--purple': '#d4a5ff',
      '--orange': '#ffb38a',
      '--text-scale': '1',
    }
  },
  deepContrast: {
    name: 'Deep Contrast',
    vars: {
      '--bg': '#000000',
      '--surface': '#050505',
      '--surface2': '#0a0a0a',
      '--surface3': '#121212',
      '--border': '#404040',   
      '--border2': '#666666',
      '--text': '#ffffff',
      '--muted': '#999999',
      '--muted2': '#777777',
      '--accent': '#ffffff',   
      '--accent-dim': '#cccccc',
      '--red': '#ff0000',
      '--purple': '#bf94ff',
      '--orange': '#ffab40',
      '--text-scale': '1',
    }
  }
}

export const ACCENT_COLORS = [
  { name: 'Lime', value: '#c8ff57', dim: '#a8d94a' },
  { name: 'Purple', value: '#7c6aff', dim: '#6a5ae8' },
  { name: 'Pink', value: '#ff57c8', dim: '#e04ab3' },
  { name: 'Orange', value: '#ff9f43', dim: '#e08a3a' },
  { name: 'Blue', value: '#57b8ff', dim: '#4aa5e8' },
  { name: 'Red', value: '#ff5757', dim: '#e04a4a' },
  { name: 'Teal', value: '#57ffd4', dim: '#4ae8c0' },
  { name: 'White', value: '#ffffff', dim: '#e0e0e0' },
  { name: 'Yellow', value: '#ffec57', dim: '#e8d44a' },
  { name: 'Cyan', value: '#57ffec', dim: '#4ae8d4' },
  { name: 'Magenta', value: '#ff57ec', dim: '#e04ad4' },
  { name: 'Gray', value: '#888888', dim: '#666666' },
]

function hexToRgbNumbers(hex) {
  hex = hex.replace(/^#/, '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export function applyTheme(vars) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
    
    if (v.startsWith('#')) {
      root.style.setProperty(`${k}-rgb`, hexToRgbNumbers(v));
    }
  }
}

export function getAccentColors(accent) {
  const found = ACCENT_COLORS.find(c => c.value.toLowerCase() === accent.toLowerCase())
  return found ? { accent: found.value, 'accent-dim': found.dim } : null
}
