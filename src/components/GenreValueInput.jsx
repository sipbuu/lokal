import React from 'react'

function splitGenres(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

export default function GenreValueInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
  disabled = false,
  listId,
  multi = false,
  className = '',
}) {
  const handlePick = (genre) => {
    if (disabled || !genre) return
    if (!multi) {
      onChange(genre)
      return
    }
    const current = splitGenres(value)
    if (current.some(item => item.toLowerCase() === genre.toLowerCase())) return
    onChange([...current, genre].join(', '))
  }

  const baseClassName = className || 'w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 disabled:opacity-40'

  return (
    <div className="space-y-2">
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={baseClassName}
        placeholder={placeholder}
      />
      {listId && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map(genre => (
            <option key={genre} value={genre} />
          ))}
        </datalist>
      )}
      {suggestions.length > 0 && (
        <div className="max-h-24 overflow-y-auto rounded-lg border border-border bg-card/40 px-2 py-2">
          <div className="flex flex-wrap gap-2">
            {suggestions.map(genre => (
              <button
                key={genre}
                type="button"
                onClick={() => handlePick(genre)}
                disabled={disabled}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-white disabled:opacity-40"
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
