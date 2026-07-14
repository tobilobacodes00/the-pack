import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMarkdown } from './chat-markdown'

describe('ChatMarkdown', () => {
  it('renders **bold** as a <strong>, not literal asterisks', () => {
    const { container } = render(<ChatMarkdown text="the **key** point" />)
    const strong = container.querySelector('strong')
    expect(strong?.textContent).toBe('key')
    expect(container.textContent).not.toContain('**')
  })

  it('renders a `- ` list as bullet <li> items', () => {
    const { container } = render(<ChatMarkdown text={'- first\n- second'} />)
    const items = container.querySelectorAll('ul li')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toBe('first')
    expect(items[1].textContent).toBe('second')
    expect(container.textContent).not.toContain('- ')
  })

  it('renders a numbered list as an ordered list', () => {
    const { container } = render(<ChatMarkdown text={'1. one\n2. two'} />)
    expect(container.querySelectorAll('ol li').length).toBe(2)
  })

  it('splits blank-line-separated paragraphs', () => {
    const { container } = render(<ChatMarkdown text={'para one\n\npara two'} />)
    expect(container.querySelectorAll('p').length).toBe(2)
  })

  it('handles bold INSIDE a bullet (the real Alpha shape)', () => {
    const { container } = render(<ChatMarkdown text={'- **Rust**: rising fast'} />)
    const strong = container.querySelector('li strong')
    expect(strong?.textContent).toBe('Rust')
  })

  it('renders `code` spans', () => {
    const { container } = render(<ChatMarkdown text="run `npm install` first" />)
    expect(container.querySelector('code')?.textContent).toBe('npm install')
  })

  it('does not inject markup from model text (safe)', () => {
    render(<ChatMarkdown text={'<script>alert(1)</script> plain'} />)
    // the angle-bracket text is rendered as literal text, never as an element
    expect(screen.getByText(/<script>alert\(1\)<\/script> plain/)).toBeTruthy()
  })

  it('leaves plain prose untouched', () => {
    const { container } = render(<ChatMarkdown text="just a normal sentence." />)
    expect(container.textContent).toBe('just a normal sentence.')
  })
})
