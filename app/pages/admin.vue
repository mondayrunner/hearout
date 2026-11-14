<script setup lang="ts">
// The admin: projects on the left, one project on the right with its links, statuses, summaries
// and transcripts. Deliberately one file with plain fetches, so it is easy to rebuild your way.
type Participant = {
  id: string
  code: string
  name: string | null
  status: 'open' | 'active' | 'done'
  end_reason: string | null
  summary_status: 'pending' | 'done' | 'failed' | null
  summary_error: string | null
  summary: string | null
  answers: number
  input_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  output_tokens: number
  link: string
}
type Project = {
  id: string
  slug: string
  name: string
  organisation: string
  brief_md: string
  max_turns: number
  participants: Participant[]
}
type Line = { turn: number; role: 'interviewer' | 'participant'; text: string; source: string | null }

// US dollars per million tokens for the model in server/utils/claude.ts. Update both together.
const PRICE = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }

useHead({ title: 'Hearout admin' })

const projects = ref<Project[]>([])
const selectedSlug = ref('')
const creating = ref(false)
const loadError = ref('')
const notice = ref('')

const selected = computed(() => projects.value.find((project) => project.slug === selectedSlug.value) ?? null)

async function load() {
  try {
    const data = await $fetch<{ projects: Project[] }>('/api/admin/projects')
    projects.value = data.projects
    if (!selected.value && !creating.value) selectedSlug.value = data.projects[0]?.slug ?? ''
    if (!data.projects.length) creating.value = true
    loadError.value = ''
  } catch {
    loadError.value = 'Could not load the projects. Reload the page to log in again.'
  }
}
onMounted(load)

function cost(participant: Participant): string {
  const dollars =
    (participant.input_tokens * PRICE.input +
      participant.cache_write_tokens * PRICE.cacheWrite +
      participant.cache_read_tokens * PRICE.cacheRead +
      participant.output_tokens * PRICE.output) /
    1_000_000
  return dollars ? `$${dollars.toFixed(3)}` : ''
}

function statusLabel(participant: Participant): string {
  if (participant.status === 'open') return 'Not started'
  if (participant.status === 'active') return `In progress, ${participant.answers} answers`
  if (participant.summary_status === 'failed') return 'Done, summary failed'
  if (participant.summary_status === 'pending') return 'Done, summary pending'
  return participant.end_reason === 'max_turns' ? 'Done, at the turn limit' : 'Done'
}

// New project
const form = reactive({ name: '', organisation: '', brief: '', topics: '', maxTurns: 12 })
const saving = ref(false)

async function createProject() {
  saving.value = true
  notice.value = ''
  try {
    const created = await $fetch<{ slug: string }>('/api/admin/projects', { method: 'POST', body: form })
    Object.assign(form, { name: '', organisation: '', brief: '', topics: '', maxTurns: 12 })
    creating.value = false
    selectedSlug.value = created.slug
    await load()
  } catch (caught) {
    notice.value = message(caught)
  } finally {
    saving.value = false
  }
}

// Participants
const names = ref('')
const adding = ref(false)

async function addParticipants() {
  if (!selected.value) return
  adding.value = true
  notice.value = ''
  const list = names.value.split('\n').map((name) => name.trim()).filter(Boolean)
  try {
    await $fetch('/api/admin/participants', {
      method: 'POST',
      body: list.length ? { projectId: selected.value.id, names: list } : { projectId: selected.value.id, count: 1 },
    })
    names.value = ''
    await load()
  } catch (caught) {
    notice.value = message(caught)
  } finally {
    adding.value = false
  }
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  notice.value = 'Link copied.'
}

// One participant: summary and transcript
const openCode = ref('')
const lines = ref<Line[]>([])
const regenerating = ref(false)

async function toggle(participant: Participant) {
  if (openCode.value === participant.code) {
    openCode.value = ''
    return
  }
  openCode.value = participant.code
  lines.value = []
  try {
    const data = await $fetch<{ lines: Line[] }>('/api/admin/conversation', { query: { code: participant.code } })
    // A slow answer for someone you already clicked away from must not land under the next name.
    if (openCode.value === participant.code) lines.value = data.lines
  } catch (caught) {
    if (openCode.value !== participant.code) return
    openCode.value = ''
    notice.value = message(caught)
  }
}

async function regenerate(participant: Participant) {
  regenerating.value = true
  notice.value = ''
  try {
    await $fetch('/api/admin/summary', { method: 'POST', body: { code: participant.code } })
  } catch (caught) {
    notice.value = message(caught)
  } finally {
    regenerating.value = false
    await load()
  }
}

function message(caught: unknown): string {
  const failure = caught as { statusMessage?: string; data?: { statusMessage?: string } }
  return failure?.data?.statusMessage ?? failure?.statusMessage ?? 'Something went wrong.'
}

const field =
  'w-full rounded-xl bg-white px-4 py-2.5 ring-1 ring-ink/10 placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent'
const button = 'rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-deep disabled:opacity-40'
const link = 'text-sm text-accent underline-offset-2 hover:underline disabled:opacity-40'
</script>

<template>
  <div class="mx-auto grid min-h-svh max-w-6xl gap-10 px-5 py-8 md:grid-cols-[14rem_1fr]">
    <aside>
      <h1 class="font-display text-2xl">Hearout</h1>
      <nav class="mt-6 space-y-1">
        <button
          v-for="project in projects"
          :key="project.id"
          type="button"
          class="block w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white"
          :class="project.slug === selectedSlug && !creating ? 'bg-white ring-1 ring-ink/10' : ''"
          @click="selectedSlug = project.slug; creating = false; openCode = ''"
        >
          <span class="block font-medium">{{ project.organisation }}</span>
          <span class="block text-muted">{{ project.name }}</span>
        </button>
      </nav>
      <button type="button" class="mt-4" :class="link" @click="creating = true">New project</button>
    </aside>

    <main class="min-w-0">
      <p v-if="loadError" class="mb-6 rounded-xl bg-accent-soft px-4 py-3 text-sm">{{ loadError }}</p>
      <p v-if="notice" class="mb-6 rounded-xl bg-accent-soft px-4 py-3 text-sm">{{ notice }}</p>

      <form v-if="creating" class="max-w-2xl space-y-4" @submit.prevent="createProject">
        <h2 class="font-display text-3xl">New project</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm">Organisation
            <input v-model="form.organisation" required maxlength="120" :class="field" class="mt-1">
          </label>
          <label class="block text-sm">Project name
            <input v-model="form.name" required maxlength="120" :class="field" class="mt-1">
          </label>
        </div>
        <label class="block text-sm">Brief: what the interviewer needs to know by the end
          <textarea
            v-model="form.brief"
            required
            rows="12"
            placeholder="You are interviewing someone at … about …&#10;&#10;WHAT YOU NEED TO KNOW BY THE END&#10;- …&#10;&#10;HOW YOU FOLLOW UP&#10;- …"
            :class="field"
            class="mt-1 font-mono text-sm"
          />
        </label>
        <label class="block text-sm">Topics for the summary, one per line (optional)
          <textarea v-model="form.topics" rows="5" :class="field" class="mt-1" />
        </label>
        <label class="block text-sm">Maximum number of questions (4 to 30)
          <input v-model.number="form.maxTurns" type="number" min="4" max="30" :class="field" class="mt-1 max-w-32">
        </label>
        <button type="submit" :class="button" :disabled="saving">Create project</button>
      </form>

      <template v-else-if="selected">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-sm text-muted">{{ selected.organisation }}</p>
            <h2 class="font-display text-3xl">{{ selected.name }}</h2>
          </div>
          <a :href="`/api/admin/export?project=${selected.slug}`" :class="link">Download everything as markdown</a>
        </div>

        <details class="mt-4 text-sm">
          <summary class="text-muted">Brief, up to {{ selected.max_turns }} questions</summary>
          <pre class="mt-3 whitespace-pre-wrap rounded-xl bg-white p-4 font-sans ring-1 ring-ink/10">{{ selected.brief_md }}</pre>
        </details>

        <ul class="mt-8 divide-y divide-ink/10 border-y border-ink/10">
          <li v-for="participant in selected.participants" :key="participant.id" class="py-4">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div class="min-w-40 flex-1">
                <p class="font-medium">{{ participant.name ?? 'No name yet' }}</p>
                <p class="text-sm text-muted">{{ statusLabel(participant) }}</p>
              </div>
              <code class="text-sm text-muted">{{ participant.code }}</code>
              <span class="w-16 text-right text-sm text-muted" :title="`${participant.cache_read_tokens} tokens read from cache`">
                {{ cost(participant) }}
              </span>
              <button type="button" :class="link" @click="copy(participant.link)">Copy link</button>
              <button type="button" :class="link" :disabled="participant.status === 'open'" @click="toggle(participant)">
                {{ openCode === participant.code ? 'Close' : 'Read' }}
              </button>
            </div>

            <div v-if="openCode === participant.code" class="mt-5 grid gap-8 lg:grid-cols-2">
              <section>
                <h3 class="font-medium">Summary</h3>
                <p v-if="participant.summary" class="mt-2 whitespace-pre-line text-sm leading-relaxed">
                  {{ participant.summary.replaceAll('**', '') }}
                </p>
                <p v-else class="mt-2 text-sm text-muted">
                  {{ participant.summary_error ?? 'No summary yet.' }}
                </p>
                <div v-if="participant.status === 'done'" class="mt-4 flex gap-5">
                  <button type="button" :class="link" :disabled="regenerating" @click="regenerate(participant)">
                    {{ regenerating ? 'Working…' : 'Make the summary again' }}
                  </button>
                  <a :href="`/api/admin/export?project=${selected.slug}&code=${participant.code}`" :class="link">Download</a>
                </div>
              </section>
              <section>
                <h3 class="font-medium">Conversation</h3>
                <div class="mt-2 space-y-3 text-sm leading-relaxed">
                  <p v-for="line in lines" :key="`${line.turn}-${line.role}`" :class="line.role === 'interviewer' ? 'text-muted' : ''">
                    <span class="whitespace-pre-line">{{ line.text }}</span>
                    <span v-if="line.source === 'suggestion'" class="text-muted"> (clicked a suggestion)</span>
                  </p>
                </div>
              </section>
            </div>
          </li>
          <li v-if="!selected.participants.length" class="py-4 text-sm text-muted">No participants yet.</li>
        </ul>

        <form class="mt-8 max-w-md space-y-3" @submit.prevent="addParticipants">
          <label class="block text-sm">Add participants, one name per line
            <textarea v-model="names" rows="3" :class="field" class="mt-1" />
          </label>
          <p class="text-sm text-muted">Leave it empty to add one link without a name. That person types their name at the start.</p>
          <button type="submit" :class="button" :disabled="adding">Add</button>
        </form>
      </template>
    </main>
  </div>
</template>
