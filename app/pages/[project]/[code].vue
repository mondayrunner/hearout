<script setup lang="ts">
// The interview page: a start screen that says what to expect, then the conversation.
//
// The latest question stands large and without a bubble, everything before it fades. That reads
// like someone who just said something instead of a chatbot with a message list, and it keeps
// the attention on one question. Mobile first: one column, large touch targets, input at the bottom.
type Message = { role: 'interviewer' | 'participant'; text: string }
type Reply = { reply: string; done: boolean; suggestions: string[]; turn?: number; maxTurns?: number }

const MAX_INPUT = 500

const route = useRoute()
const code = String(route.params.code ?? '').toLowerCase()

const { data: start, error: startError } = await useFetch(`/api/participant/${code}`)

const messages = ref<Message[]>([...(start.value?.messages ?? [])])
const turn = ref(start.value?.turn ?? 0)
const maxTurns = ref(start.value?.maxTurns ?? 12)
const done = ref(start.value?.done ?? false)
const suggestions = ref<string[]>([...(start.value?.suggestions ?? [])])
const name = ref(start.value?.name ?? '')
const started = ref(messages.value.length > 0 || done.value)
const input = ref('')
const busy = ref(false)
const error = ref('')
const conversation = ref<HTMLElement | null>(null)

useHead({ title: start.value ? `Interview: ${start.value.projectName}` : 'Interview' })

const progress = computed(() => Math.min(Math.round((turn.value / maxTurns.value) * 100), 100))
const lastIndex = computed(() => messages.value.length - 1)

function scrollDown() {
  nextTick(() => {
    if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight
  })
}

async function send(text: string, source: 'typed' | 'suggestion' = 'typed') {
  if (busy.value || done.value) return
  const message = text.trim().slice(0, MAX_INPUT)
  if (!message && messages.value.length > 0) return

  const previousSuggestions = suggestions.value
  error.value = ''
  busy.value = true
  suggestions.value = []
  if (message) {
    messages.value.push({ role: 'participant', text: message })
    scrollDown()
  }
  input.value = ''

  try {
    const answer = await $fetch<Reply>('/api/chat', {
      method: 'POST',
      body: { code, message, name: name.value, source },
    })
    messages.value.push({ role: 'interviewer', text: answer.reply })
    suggestions.value = answer.suggestions ?? []
    if (answer.turn) turn.value = answer.turn
    if (answer.maxTurns) maxTurns.value = answer.maxTurns
    done.value = answer.done
    scrollDown()
  } catch (caught) {
    const failure = caught as { statusMessage?: string; data?: { statusMessage?: string } }
    error.value = failure?.data?.statusMessage ?? failure?.statusMessage ?? 'Something went wrong. Please try again.'
    // The answer goes back into the input field, so nobody has to type it again.
    if (message) {
      messages.value.pop()
      if (source === 'typed') input.value = message
    }
    suggestions.value = previousSuggestions
  } finally {
    busy.value = false
  }
}

async function begin() {
  name.value = name.value.trim().slice(0, 80)
  if (!name.value) return
  started.value = true
  await send('')
  // Without a first question there is nothing to answer: back to the start screen, where the
  // error is shown and Start tries again.
  if (!messages.value.length) started.value = false
}

onMounted(scrollDown)
</script>

<template>
  <div class="mx-auto flex h-svh max-w-2xl flex-col px-5 py-6 sm:px-6">
    <div v-if="startError" class="m-auto max-w-md text-center">
      <h1 class="font-display text-3xl">This link doesn't work</h1>
      <p class="mt-3 text-ink/70">Check whether you copied the whole link, or ask for a new one.</p>
    </div>

    <template v-else>
      <header class="flex items-baseline justify-between gap-4 text-sm text-muted">
        <span class="font-medium text-ink">{{ start?.organisation }}</span>
        <span class="truncate">{{ start?.projectName }}</span>
      </header>

      <!-- The start screen: first what to expect, then the field, so nobody starts blind. -->
      <div v-if="!started" class="my-auto py-12">
        <h1 class="font-display text-3xl leading-[1.15] sm:text-4xl" style="text-wrap: balance">
          A short conversation instead of a form
        </h1>
        <ul class="mt-8 space-y-3 text-ink/75">
          <li>You type in your own words, and you get follow-up questions.</li>
          <li>It takes about ten minutes and works fine on a phone.</li>
          <li>There is nothing to prepare and there are no wrong answers.</li>
          <li>Please leave out names, email addresses and phone numbers of other people.</li>
        </ul>

        <form class="mt-9 flex flex-col gap-3 sm:flex-row" @submit.prevent="begin">
          <input
            v-model="name"
            type="text"
            maxlength="80"
            placeholder="Your name"
            aria-label="Your name"
            autocomplete="given-name"
            class="flex-1 rounded-full bg-white px-6 py-4 ring-1 ring-ink/10 transition placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent"
          >
          <button
            type="submit"
            class="rounded-full bg-accent px-8 py-4 font-medium text-white transition hover:bg-accent-deep disabled:opacity-40"
            :disabled="!name.trim() || busy"
          >
            Start
          </button>
        </form>
        <p v-if="error" class="mt-4 rounded-2xl bg-accent-soft px-5 py-3 text-sm">{{ error }}</p>
      </div>

      <template v-else>
        <div v-if="!done" class="mt-4">
          <p class="text-xs text-muted">Question {{ Math.max(turn, 1) }} of up to {{ maxTurns }}</p>
          <div class="mt-2 h-px w-full bg-ink/10">
            <div class="h-px bg-accent transition-all duration-700" :style="{ width: `${progress}%` }" />
          </div>
        </div>

        <div ref="conversation" class="flex-1 space-y-6 overflow-y-auto py-8">
          <div v-for="(message, index) in messages" :key="index">
            <p
              v-if="message.role === 'interviewer'"
              class="font-display leading-snug"
              :class="index === lastIndex ? 'rise text-2xl text-ink sm:text-[28px]' : 'text-lg text-ink/40'"
            >
              {{ message.text }}
            </p>
            <p
              v-else
              class="ml-auto w-fit max-w-[85%] whitespace-pre-line rounded-2xl bg-white px-5 py-3 text-[15px] leading-relaxed ring-1 ring-ink/5"
              :class="index === lastIndex ? 'text-ink' : 'text-ink/50'"
            >
              {{ message.text }}
            </p>
          </div>

          <div v-if="busy" class="flex gap-1.5 py-1" aria-label="Typing">
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:120ms]" />
            <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:240ms]" />
          </div>
        </div>

        <div class="pt-2">
          <p v-if="error" class="mb-3 rounded-2xl bg-accent-soft px-5 py-3 text-sm">{{ error }}</p>

          <!-- No second thank-you: the interviewer already said it above. -->
          <div v-if="done" class="border-t border-ink/10 py-10 text-center">
            <p class="font-medium">Interview complete</p>
            <p class="mx-auto mt-2 max-w-sm text-ink/70">Your answers are in. You can close this screen.</p>
          </div>

          <template v-else>
            <div v-if="suggestions.length" class="mb-3 flex flex-wrap gap-2">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion"
                type="button"
                class="rounded-full bg-white px-4 py-2 text-left text-sm text-ink/80 ring-1 ring-ink/10 transition hover:bg-accent hover:text-white hover:ring-accent"
                @click="send(suggestion, 'suggestion')"
              >
                {{ suggestion }}
              </button>
            </div>

            <form class="flex items-end gap-2" @submit.prevent="send(input)">
              <textarea
                v-model="input"
                rows="2"
                :maxlength="MAX_INPUT"
                placeholder="Type your answer…"
                aria-label="Your answer"
                class="flex-1 resize-none rounded-3xl bg-white px-5 py-3.5 leading-relaxed ring-1 ring-ink/10 transition placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent"
                @keydown.enter.exact.prevent="send(input)"
              />
              <button
                type="submit"
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-deep disabled:opacity-30"
                :disabled="busy || !input.trim()"
                aria-label="Send"
              >
                <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </form>
            <p class="mt-2 text-xs text-muted">{{ input.length }}/{{ MAX_INPUT }} characters. Enter sends.</p>
          </template>
        </div>
      </template>
    </template>
  </div>
</template>
