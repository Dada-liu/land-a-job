import type { Project } from '../types/resume'
import { toAbsoluteUrl } from '../utils/url'
import { ResumeLink } from './ResumeLink'

export function ProjectName({ project }: { project: Project }) {
  return (
    <ResumeLink href={toAbsoluteUrl(project.url ?? '')} accent>
      {project.name}
    </ResumeLink>
  )
}
