import { describe, expect, it } from 'vitest'
import { textToHtml } from '../../supabase/functions/send-emails/html'

describe('email html', () => {
  it('escapes text, keeps lines, links the event page', () => {
    const h = textToHtml("Hi Kirk,\n\nTeam: <Noyes> & McLeod\nPlayers: A, B\n\nTee times: https://redraider16.github.io/flagstick/e/AQWA33\n", "You're registered")
    expect(h).toContain('Team: &lt;Noyes&gt; &amp; McLeod<br>Players: A, B')
    expect(h).toContain('<a href="https://redraider16.github.io/flagstick/e/AQWA33"')
    expect(h).not.toContain('<Noyes>')
  })
})
