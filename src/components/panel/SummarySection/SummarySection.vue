<!--
  SummarySection – power, buildings, build cost, products, shortages, surplus; the whole project
  (logic: SummarySection.ts, styles: SummarySection.scss).
-->
<template>
  <section v-if="plan.status === 'optimal'">
    <h2>Summary</h2>

    <div class="stats">
      <div class="stat">
        <div class="stat-value stat-value--power">{{ formatPower(summary.totalPower) }}</div>
        <div class="stat-label">Power demand</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ summary.totalRounded }}</div>
        <div class="stat-label">Buildings (to place)</div>
      </div>
    </div>

    <table class="buildings">
      <thead>
        <tr>
          <th>Building</th>
          <th>Exact</th>
          <th>To place</th>
          <th>Power</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in summary.buildings" :key="b.building.id">
          <td>{{ b.building.name }}</td>
          <td class="num">{{ formatCount(b.count) }}</td>
          <td class="num">{{ b.roundedCount }}</td>
          <td class="num">{{ formatPower(b.power) }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Minimum build cost (without rails) -->
    <div class="cost">
      <div class="field-label">
        <strong>Build cost</strong> <span class="muted">(minimum, without rails)</span>
      </div>
      <div v-for="c in summary.buildCost" :key="c.item" class="io-line cost-line">
        <ItemIcon standalone :item="index.item(c.item)" :size="16" />
        <span class="cost-name">{{ index.item(c.item).name }}</span>
        <span class="num">{{ formatCount(c.quantity) }}</span>
      </div>
      <div v-if="!summary.buildCost.length && !summary.unknownCost.length" class="entity-empty">
        no buildings to place
      </div>
      <p v-if="summary.unknownCost.length" class="hint">
        No cost given: {{ summary.unknownCost.map((b) => b.name).join(', ') }}
      </p>
    </div>

    <div v-if="summary.products.length" class="callout callout--ok">
      <strong>End product</strong> (unlinked output, or goes into storage):
      <div v-for="r in summary.products" :key="r.item" class="io-line">
        <ItemIcon standalone :item="index.item(r.item)" :size="16" />
        {{ index.item(r.item).name }} · {{ formatRate(r.rate) }}{{ RATE_UNIT_LABEL }}
      </div>
    </div>

    <div v-if="summary.shortages.length" class="callout callout--error">
      <strong>Shortage</strong> (click the node):
      <div
        v-for="r in summary.shortages"
        :key="r.nodeId + r.item"
        class="io-line clickable"
        @click="goTo(r.nodeId)"
      >
        <ItemIcon standalone :item="index.item(r.item)" :size="16" />
        {{ r.title }}: {{ index.item(r.item).name }} {{ formatRate(r.rate) }}{{ RATE_UNIT_LABEL }}
        <span class="muted">{{ r.linked ? '(too little arrives)' : '(not linked)' }}</span>
      </div>
    </div>

    <div v-if="noData.length" class="callout callout--warn">
      <strong>⚠︎ No cycle time data</strong> (click the node; it can be entered in the editor or below, under
      Missing data):
      <div
        v-for="x in noData"
        :key="x.node.id"
        class="io-line clickable"
        :title="x.note.text"
        @click="goTo(x.node.id)"
      >
        <ItemIcon v-if="x.node.recipe" standalone :item="index.item(x.node.recipe.product)" :size="16" />
        {{ x.node.title }}
        <span class="muted">
          · {{ x.node.building?.name }} · {{ x.note.kind === 'missing' ? 'computes with 0' : x.note.short }}
        </span>
      </div>
    </div>

    <div v-if="summary.surplus.length" class="callout callout--warn">
      <strong>Surplus</strong> (linked, but not taken):
      <div v-for="r in summary.surplus" :key="r.item" class="io-line">
        <ItemIcon standalone :item="index.item(r.item)" :size="16" />
        {{ index.item(r.item).name }} · {{ formatRate(r.rate) }}{{ RATE_UNIT_LABEL }}
      </div>
    </div>

    <!-- The whole project, when there are several bases -->
    <div v-if="multiBase" class="project-total">
      <div class="field-label">
        <strong>Whole project</strong> <span class="muted">({{ project.bases.length }} bases)</span>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-value stat-value--power">{{ formatPower(projectSummary.totalPower) }}</div>
          <div class="stat-label">Power demand</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ projectSummary.totalRounded }}</div>
          <div class="stat-label">Buildings (to place)</div>
        </div>
      </div>
      <div v-for="c in projectSummary.buildCost" :key="c.item" class="io-line cost-line">
        <ItemIcon standalone :item="index.item(c.item)" :size="16" />
        <span class="cost-name">{{ index.item(c.item).name }}</span>
        <span class="num">{{ formatCount(c.quantity) }}</span>
      </div>
      <p v-if="projectSummary.unknownCost.length" class="hint">
        No cost given: {{ projectSummary.unknownCost.map((b) => b.name).join(', ') }}
      </p>
    </div>

    <p v-if="railCosts" class="hint">Rails are priced separately, per piece: {{ railCosts }}.</p>
  </section>
</template>

<script lang="ts" src="./SummarySection.ts"></script>
<style lang="scss" scoped src="./SummarySection.scss"></style>
