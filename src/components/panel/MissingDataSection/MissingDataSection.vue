<!--
  MissingDataSection – manual cycle times for recipes without data (logic: MissingDataSection.ts).
-->
<template>
  <section v-if="missing.length || stale.length">
    <details :open="unsetCount > 0">
      <summary>
        <h2>
          Missing data
          <span class="muted">({{ unsetCount }} not set / {{ missing.length }})</span>
        </h2>
      </summary>

      <p class="hint">
        These recipes have no cycle time in the data, and will not have one until the next data update. Until
        then the factory computes with 0, and "Build chain" does not use them. If you know the cycle time
        (e.g. from the game), enter it here: it is saved with the project and used until certain data exists
        (the factory shows ⚠).
      </p>

      <div v-for="r in missing" :key="r.id" class="missing-row">
        <div class="missing-head">
          <ItemIcon standalone :item="index.item(r.product)" :size="16" />
          <strong>{{ r.name }}</strong>
          <span class="muted">· {{ index.building(r.building).name }}</span>
        </div>

        <div class="muted missing-io">Per cycle: {{ perCycleText(r, name) }}</div>

        <label class="cycle-field">
          Cycle time (s):
          <input
            type="number"
            min="0"
            step="any"
            :value="cycleTimes[r.id] ?? ''"
            placeholder="not set"
            :aria-label="`Cycle time of ${r.name} in seconds`"
            @change="setCycleTime(r.id, $event)"
          />
          <span v-if="cycleTimes[r.id]" class="muted">
            = {{ outputPerMin(r.id, r.perCycle?.outputs[0]?.amount ?? 0) }} {{ RATE_UNIT_LABEL }}/machine
          </span>
          <button v-if="cycleTimes[r.id]" type="button" class="link-btn" @click="clearCycleTime(r.id)">
            Delete
          </button>
        </label>
      </div>

      <template v-if="stale.length">
        <div class="field-label stale-title">No longer needed</div>
        <div v-for="x in stale" :key="x.id" class="stale-row">
          <span>
            {{ x.recipe?.name ?? x.id }}: {{ cycleTimes[x.id] }} s
            <span class="muted"
              >· {{ x.recipe ? 'data available, computed from the data' : 'no such recipe' }}</span
            >
          </span>
          <button type="button" class="link-btn" @click="clearCycleTime(x.id)">Delete</button>
        </div>
      </template>
    </details>
  </section>
</template>

<script lang="ts" src="./MissingDataSection.ts"></script>
<style lang="scss" scoped src="./MissingDataSection.scss"></style>
