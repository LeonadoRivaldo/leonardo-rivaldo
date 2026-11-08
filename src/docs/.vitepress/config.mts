import { defineConfig } from 'vitepress'
import experiencePages from './experiences.generated.mjs'

const [owner, repository] = process.env.GITHUB_REPOSITORY?.split('/') ?? []
const isUserSite = repository?.toLowerCase() === `${owner?.toLowerCase()}.github.io`
const base = process.env.GITHUB_ACTIONS === 'true' && repository && !isUserSite
  ? `/${repository}/`
  : '/'

export default defineConfig({
  lang: 'en-US',
  title: 'Leonardo Rivaldo',
  description: 'Software engineering experience and skills of Leonardo Rivaldo.',
  base,
  srcExclude: ['Notas_Consolidacao.md', 'README - *.md'],
  themeConfig: {
    nav: [
      { text: 'Bio', link: '/' },
      { text: 'Experience', link: '/experiencias/' },
      { text: 'Skills', link: '/skills' }
    ],
    sidebar: [
      {
        text: 'Overview',
        items: [
          { text: 'Bio', link: '/' },
          { text: 'Skills', link: '/skills' },
          { text: 'All experiences', link: '/experiencias/' }
        ]
      },
      {
        text: 'Experience',
        items: [
          { text: 'All experiences', link: '/experiencias/' },
          ...experiencePages,
        ]
      }
    ],
    search: { provider: 'local' },
    outline: 'deep',
    footer: { message: 'Leonardo Rivaldo · Senior Software Engineer' }
  }
})