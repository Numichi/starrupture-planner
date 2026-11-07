<!--
  LinkEditor – one rail between two nodes: its items, flow, rail setting, the two ends and the
  distribution across parallel rails (logic: LinkEditor.ts, styles: LinkEditor.scss).
-->
<template>
  <template v-if="link && item">
    <div class="link-head">
      <span class="icons">
        <ItemIcon v-for="it in railItems" :key="it.id" standalone :item="it" :size="18" />
      </span>
      <strong>{{ flows.length > 1 ? `${flows.length} items on one rail` : item.name }}</strong>
    </div>

    <div class="ends">
      <span class="end">{{ fromNode?.title ?? link.from }}</span>
      <span class="arrow">→</span>
      <span class="end">{{ toNode?.title ?? link.to }}</span>
    </div>

    <!-- Items on the rail: how much of each -->
    <div class="rail-items">
      <div v-for="f in flows" :key="f.linkId" class="item-row">
        <ItemIcon standalone :item="index.item(f.item)" :size="14" />
        <span class="item-name">{{ itemName(f.item) }}</span>
        <span class="num">{{ formatRate(f.rate) }}</span>
        <span class="muted share">{{ share(f.rate) }}%</span>
        <button
          v-if="flows.length > 1"
          type="button"
          class="icon-btn item-x"
          :title="`Take ${itemName(f.item)} off this rail (its link is deleted)`"
          @click="removeItem(f.linkId)"
        >
          ×
        </button>
      </div>
    </div>

    <div class="editor-status" :class="{ 'status--bad': rail?.congested }">
      <div>
        {{ flows.length > 1 ? 'Rail flow' : 'Flow' }}: <strong>{{ formatRate(total) }}</strong>
        {{ RATE_UNIT_LABEL }}
        <span v-if="rail?.congested" class="bad-inline"> · demand {{ formatRate(demand) }}</span>
      </div>

      <template v-if="rail">
        <div>
          Rail: <strong>{{ railLabel(rail) }}</strong> = {{ formatRate(rail.capacity) }} {{ RATE_UNIT_LABEL }}
          <span class="muted"
            >({{ rail.mode === 'auto' ? 'automatic' : 'manual' }} · {{ pct(rail.load) }})</span
          >
        </div>

        <div class="meter" :class="{ 'meter--bad': rail.congested, 'meter--warn': scaled }">
          <div :style="{ width: meterWidth }" />
        </div>

        <div v-if="scaled" class="warn-line">
          One {{ rail.tier.name }} rail carries {{ formatRate(rail.tier.capacity) }} {{ RATE_UNIT_LABEL }}:
          this needs {{ rail.count }} parallel rails ({{ railLabel(rail) }}). Not an error, just more rails to
          place (below: distribution).
        </div>

        <template v-if="rail.congested">
          <div class="bad">
            <strong>Congestion:</strong> {{ formatRate(demand) }} {{ RATE_UNIT_LABEL }} would pass, the
            configured {{ railLabel(rail) }} only lets {{ formatRate(rail.capacity) }} through.
            {{ partsLabel(rail.needed) }} would be needed.
          </div>
          <div class="btn-row">
            <button type="button" class="link-btn" @click="setRails(toCounts(rail.needed))">
              Set {{ partsLabel(rail.needed) }}
            </button>
            <button type="button" class="link-btn" @click="setMode('auto')">Automatic</button>
          </div>
        </template>
      </template>

      <div v-else-if="!availableRails.length" class="muted">No rail data.</div>
      <div v-else class="muted">Nothing moves on it, so no rail is needed (automatic).</div>
    </div>

    <!-- Rail setting (for every item of the rail) -->
    <template v-if="availableRails.length">
      <div class="field">
        <span>Rail{{ flows.length > 1 ? ` (for all ${flows.length} items)` : '' }}</span>
        <div class="segmented" role="radiogroup" aria-label="Rail">
          <button
            type="button"
            role="radio"
            :aria-checked="!manual"
            :class="{ active: !manual }"
            @click="setMode('auto')"
          >
            Automatic
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="manual"
            :class="{ active: manual }"
            @click="setMode('manual')"
          >
            Manual
          </button>
        </div>
      </div>

      <div v-if="link.rail?.length" class="field">
        <span>Rails (count per tier, mixed allowed)</span>
        <RailSetEditor :rails="link.rail" :available="availableRails" @update="setRails" />
      </div>

      <p v-if="rail?.tierUnavailable" class="hint bad">
        A chosen tier is not among the available ones; computed with the best available ({{
          availableRails.at(-1)?.name
        }}).
      </p>
      <p class="hint">{{ modeHint }}</p>
    </template>

    <!-- The two ends: what sets the pace -->
    <div class="section-title">The two ends of the rail</div>
    <div v-for="(ep, i) in [source, target]" :key="i" class="end-card">
      <template v-if="ep">
        <div class="end-head">
          <span class="muted">{{ i === 0 ? 'Source' : 'Receiver' }} · {{ ep.kind }}:</span>
          <strong>{{ ep.title }}</strong>
        </div>
        <div v-for="(l, j) in ep.lines" :key="j" :class="l.tone ? `tone-${l.tone}` : ''">{{ l.text }}</div>
      </template>
    </div>

    <!-- Distribution across the rails -->
    <template v-if="distribution">
      <div class="section-title">Distribution across the rails</div>

      <p v-if="rail?.congested" class="hint bad">
        Because of the congestion, computed for the demand ({{ formatRate(distribution.rate) }}
        {{ RATE_UNIT_LABEL }}), with the rails that would be needed: {{ partsLabel(rail.needed) }}.
      </p>

      <div v-for="sp in splits" :key="sp.key" class="split">
        <div class="split-title" :title="sp.hint">{{ sp.title }}</div>
        <table class="dist">
          <thead>
            <tr>
              <th>Rail</th>
              <th class="num">{{ RATE_UNIT_LABEL }}</th>
              <th class="num">%</th>
              <th v-if="showSources" class="num" title="This many source machines belong to this rail">
                Source machines
              </th>
              <th v-if="showTargets" class="num" title="This rail serves this many receiving machines">
                Receiving machines
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(g, gi) in sp.split.groups" :key="gi" :class="{ muted: g.share.rate <= 0 }">
              <td>{{ rowLabel(g.rails, g.tier.name, g.share) }}</td>
              <td class="num">{{ formatRate(g.share.rate) }}</td>
              <td class="num">{{ pct(g.share.load) }}</td>
              <td v-if="showSources" class="num">{{ g.share.rate > 0 ? machines(g.share.sources) : '–' }}</td>
              <td v-if="showTargets" class="num">{{ g.share.rate > 0 ? machines(g.share.targets) : '–' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="split-hint">{{ sp.hint }}</div>
      </div>

      <p class="hint">
        Machines per rail: in proportion to the rail's flow (after "→" rounded up: that many to place). For a
        receiving machine the tightest of its items on the rail decides; the rate is the nominal one (the
        machine at full speed). A non-machine end (storage, cargo, rail line) has no machine count: see above
        what sets the pace.
      </p>
    </template>

    <div class="btn-row">
      <button type="button" class="link-btn" @click="selectEnds">Select both ends</button>
      <button type="button" class="danger-btn" @click="removeAll">
        {{ flows.length > 1 ? 'Delete rail (all its items)' : 'Delete link' }}
      </button>
    </div>
  </template>

  <p v-else class="hint">This link no longer exists.</p>
</template>

<script lang="ts" src="./LinkEditor.ts"></script>
<style lang="scss" scoped src="./LinkEditor.scss"></style>
