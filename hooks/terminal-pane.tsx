/** The terminal pane: the hero line, the orchestrator and agent lines, and the todo lines, as text. */

import type { EngineInterface, RenderInput } from 'claude-code'
import type { View } from './card-types'
import type { PaneKit } from './pane-kit'
import { isEnded } from './agent-ends'
import { agentColor, agentLabel, ORCH } from './agent-identity'
import { clock, elapsed, tokens } from './card-format'
import { ACCENT, DANGER, GREEN } from './card-stage'
import { keyText } from './card-text'
import { heroText } from './hero-card'
import { orchestratorView } from './orchestrator-history'
import { bar, clip } from './terminal-text'
import { ledger, todoLedger } from './view-model'
import { ITEMS_SHOWN } from './pane-constants'
import { redraw } from './pane-redraw'
import { S, expandedFiles } from './state'
import { toastFailure } from './toasts'
import { todoActions, todoCount, todoDetail } from './todo-heading'
import { openArchive } from './trash-files'

export function terminalPane($: EngineInterface, kit: PaneKit, e: RenderInput<'Pane'>, view: View) {
  const { Box, Button, Text } = kit
const columns = e.props.bodyColumns ?? 40
const width = Math.max(10, Math.min(30, columns - 16))
const chip = (i: number) => (
  <Text key={keyText(`chip-${i}`)} backgroundColor={agentColor(i)} color="#FFFFFF" bold>
    {` ${agentLabel(i)} `}
  </Text>
)
const heading = (label: string, detail: string) => (
  <Box marginTop={1}>
    <Text bold>{label}</Text>
    <Text dimColor>{detail === '' ? '' : `  ${detail}`}</Text>
  </Box>
)

return (
  <Box flexDirection="column">
    <Text key="hero-line" dimColor>{heroText(view)}</Text>
    {heading('Orchestrator', S.orchestrator.isActive ? '' : 'Idle')}
    {orchestratorView(S.orchestrator.history, 0).entries.slice(0, 5).map(entry => (
      <Text key={keyText(`orchestrator-${entry.id}`)} dimColor={!entry.isRunning}>
        {` ${entry.isRunning ? '•' : '·'} ${clock(entry.at)}  ${entry.line}`}
        {entry.detail !== undefined && <Text dimColor>{`  ${clip(entry.detail, Math.max(10, columns - 20 - entry.line.length))}`}</Text>}
      </Text>
    ))}
    {heading('Agents', view.agents.length === 0 ? '' : `${view.live} running, ${ledger(view, false).idle.length > 0 ? `${ledger(view, false).idle.length} idle, ` : ''}${ledger(view, false).finished.length + (view.dropped ?? 0)} done`)}
    {ledger(view, S.isFinishedShown).finished.length > 0 && (
      <Button
        key="agents-toggle"
        label={S.isFinishedShown ? 'Hide finished agents' : `Show finished agents (${ledger(view, S.isFinishedShown).finished.length})`}
        onPress={() => {
          S.isFinishedShown = !S.isFinishedShown
          redraw($)
        }}
      />
    )}
    {view.orchestrator !== undefined && (
      <Box key="a-orchestrator" flexDirection="column" marginTop={1}>
        <Box>
          {chip(ORCH)}
          <Text bold>{` ${view.orchestrator.description}`}</Text>
        </Box>
        {view.orchestrator.links.map((link, n) => (
          // Keyed by place: two linked tickets can have the same text.
          <Box key={keyText(`link-${n}`)}>
            <Text dimColor>{'  Working on '}</Text>
            <Text color={agentColor(ORCH)}>{clip(link, columns - 16)}</Text>
          </Box>
        ))}
        <Text dimColor>
          {`  ${view.orchestrator.type} · `}
          <Text color={ACCENT}>running</Text>
          {` · ${view.orchestrator.toolCalls} tool call${view.orchestrator.toolCalls === 1 ? '' : 's'}`}
        </Text>
        {view.orchestrator.doing !== undefined && <Text dimColor>{`  ${clip(view.orchestrator.doing, columns - 12)}`}</Text>}
      </Box>
    )}
    {ledger(view, S.isFinishedShown).shown.map(agent => {
      const failed = agent.status === 'failed' || agent.status === 'killed'

      return (
        <Box key={keyText(`a-${agent.id ?? agent.index}`)} flexDirection="column" marginTop={1}>
          <Box>
            {chip(agent.index)}
            <Text bold={!agent.isEnded} dimColor={agent.isEnded}>{` ${clip(agent.description, columns - 8)}`}</Text>
          </Box>
          {agent.links.map((link, n) => (
            <Box key={keyText(`link-${n}`)}>
              <Text dimColor>{'  Working on '}</Text>
              <Text color={agentColor(agent.index)}>{clip(link, columns - 16)}</Text>
            </Box>
          ))}
          <Text dimColor>
            {`  ${agent.type}${agent.model ? ` · ${agent.model}` : ''} · `}
            <Text color={failed ? DANGER : agent.isEnded ? GREEN : ACCENT}>{failed ? '✕ ' : agent.isEnded ? '✓ ' : ''}{agent.isIdle ? 'idle, not stopped' : agent.status}</Text>
            {` · ${elapsed((agent.endedAt ?? agent.idleSince ?? view.now) - agent.startedAt)} · ${agent.toolCalls} tool call${agent.toolCalls === 1 ? '' : 's'}${agent.tokens ? ` · ${tokens(agent.tokens)} tokens` : ''}`}
          </Text>
          {!agent.isEnded && agent.progress !== undefined && (
            <Text color={ACCENT}>
              {`  ${bar(agent.progress.done, agent.progress.total, 10)} step ${Math.min(agent.progress.done + 1, agent.progress.total)} of ${agent.progress.total}${agent.progress.step ? `: ${clip(agent.progress.step, columns - 30)}` : ''}`}
            </Text>
          )}
          {!agent.isEnded && agent.doing !== undefined && <Text dimColor>{`  ${clip(agent.doing, columns - 4)}`}</Text>}
        </Box>
      )
    })}
    {heading('Todo', view.total === 0 && todoCount() === 0 && S.unreadPlaces.length === 0 ? '' : todoDetail(view))}
    {todoActions($).map(one => (
      <Button key={one.key} label={one.label} onPress={one.onPress} />
    ))}
    {view.total > 0 && <Text color={ACCENT}>{`${bar(view.done, view.total, width)} ${Math.round((view.done / view.total) * 100)}%`}</Text>}
    {S.archiveLink !== undefined && <Button key="todo-show-completed" label={`Show completed (${view.archived})`} onPress={() => void openArchive($).catch(toastFailure($, 'open the archive'))} />}
    {todoLedger(view).map((file, _, all) => (
      <Box key={keyText(file.id)} flexDirection="column" marginTop={1}>
        <Text dimColor={file.done === file.total} bold={file.done < file.total}>
          {`${clip(`${file.name}${all.filter(one => one.name === file.name).length > 1 && file.place ? ` ${file.place}` : ''}`, columns - 24)}  ${bar(file.done, file.total, 10)} ${file.done}/${file.total}`}
        </Text>
        {file.items.slice(0, expandedFiles.has(`file:${file.id}`) ? file.items.length : ITEMS_SHOWN).map(item => (
          // Keyed by the ticket, not its place, so an insert does not remount every row below it.
          <Box key={keyText(`${file.id}:${item.key}`)}>
            <Text dimColor={item.status !== 'completed'}>
              {item.status === 'in_progress' ? ' • ' : item.status === 'completed' ? ' ✓ ' : item.status === 'queued' ? ' ≡ ' : ' ○ '}
            </Text>
            <Text bold={item.owners.length > 0} color={item.owners[0] === undefined ? undefined : agentColor(item.owners[0])} dimColor={item.owners.length === 0 && item.status === 'pending'}>{clip(item.text, columns - 8 - item.owners.length * 5)}</Text>
            {item.owners.map(i => (
              <Text key={keyText(`l-${i}`)}> {chip(i)}</Text>
            ))}
          </Box>
        ))}
        {file.items.length > ITEMS_SHOWN && (
          <Button
            key={keyText(`file-toggle-${file.id}`)}
            label={expandedFiles.has(`file:${file.id}`) ? 'Show fewer' : `Show all ${file.items.length} items`}
            onPress={() => {
              if (expandedFiles.has(`file:${file.id}`)) {
                expandedFiles.delete(`file:${file.id}`)
              } else {
                expandedFiles.add(`file:${file.id}`)
              }
              redraw($)
            }}
          />
        )}
      </Box>
    ))}
  </Box>
)
}
