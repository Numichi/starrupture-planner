<!--
  NodesSection – the nodes of the active base per kind, with a short state (logic: NodesSection.ts).
-->
<template>
  <section v-if="activeBase">
    <h2>Nodes</h2>

    <p v-if="!groups.length" class="hint hint--first">
      Nothing in this base yet. Right-click the canvas to place a factory, mine, Receiver or another element.
    </p>

    <div v-for="g in groups" :key="g.kind" class="entity-group">
      <div class="entity-group-title">
        <span
          >{{ g.label }} <span class="muted">({{ g.nodes.length }})</span></span
        >
      </div>

      <div
        v-for="n in g.nodes"
        :key="n.id"
        class="entity-row"
        :class="{ selected: selection.includes(n.id) }"
        @click="open(n)"
      >
        <ItemIcon v-if="rowIcon(n)" standalone :item="rowIcon(n)" :size="16" />
        <span class="entity-name">{{ n.title }}</span>
        <span class="entity-meta" :class="{ bad: meta(n).bad }">{{ meta(n).text }}</span>
      </div>
    </div>
  </section>
</template>

<script lang="ts" src="./NodesSection.ts"></script>
<style lang="scss" scoped src="./NodesSection.scss"></style>
