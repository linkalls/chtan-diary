// @ts-check
import { defineConfig } from 'astro/config';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  site: isPages ? `https://${process.env.GITHUB_REPOSITORY_OWNER}.github.io` : undefined,
  base: isPages && repo ? `/${repo}/` : '/',
  output: 'static',
});
