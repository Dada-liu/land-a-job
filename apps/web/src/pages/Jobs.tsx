import { JobLibraryTabs, type JobLibrary } from '../components/JobLibraryTabs'
import { useSessionState } from '../lib/sessionState'
import { useT } from '../i18n'
import PrivateJobs from './PrivateJobs'
import PublicJobs from './PublicJobs'

export default function Jobs() {
  const t = useT()
  const [library, setLibrary] = useSessionState<JobLibrary>('jobs.library', 'private')
  const selected = library === 'public' ? 'public' : 'private'

  return (
    <div>
      <JobLibraryTabs
        value={selected}
        labels={{ private: t('私有库'), public: t('公开库') }}
        onChange={setLibrary}
      />
      <div role="tabpanel" aria-labelledby={`job-library-tab-${selected}`}>
        {selected === 'private' ? <PrivateJobs /> : <PublicJobs />}
      </div>
    </div>
  )
}
