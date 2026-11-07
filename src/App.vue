<!--
  App – main layout: side panel | graph + editor (logic: App.ts, styles: App.scss).
-->
<template>
  <div class="app">
    <SidePanel class="app-panel" />

    <main class="app-graph">
      <ProductionGraph />
      <EntityEditor />
    </main>
  </div>
</template>

<script lang="ts" src="./App.ts"></script>
<style lang="scss" scoped src="./App.scss"></style>
