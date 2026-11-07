<!--
  ProductionGraph – the SVG canvas of the active base: edges, labels, nodes, selection, dragged links,
  toolbar, help, popups and messages (logic: ProductionGraph.ts, styles: ProductionGraph.scss).
-->
<template>
  <div ref="rootEl" class="graph">
    <svg
      ref="svgEl"
      class="graph-svg"
      :class="cursorClass"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent
    >
      <defs>
        <pattern
          id="grid-dots"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
          :patternTransform="transform"
        >
          <circle cx="1" cy="1" r="1" class="grid-dot" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-dots)" />

      <g :transform="transform">
        <GraphEdge
          v-for="e in layout.edges"
          :key="'line-' + e.edge.id"
          part="line"
          :pos="e"
          :max-rate="maxRate"
          :dimmed="edgeDimmed(e.edge.id)"
          :highlighted="edgeHighlighted(e.edge.id)"
          :selected="isSelectedRail(e)"
        />

        <line
          v-for="m in pairMarkers"
          :key="m.id"
          class="pair-marker"
          :x1="m.x1"
          :y1="m.y1"
          :x2="m.x2"
          :y2="m.y2"
        />

        <GraphEdge
          v-for="e in layout.edges"
          :key="'label-' + e.edge.id"
          part="label"
          :pos="e"
          :max-rate="maxRate"
          :label-at="labelPositions.get(e.edge.id)"
          :dimmed="edgeDimmed(e.edge.id)"
          :selected="isSelectedRail(e)"
        />

        <template v-for="n in layout.nodes" :key="n.node.id">
          <LineNode
            v-if="n.node.kind === 'line'"
            :pos="n"
            :dimmed="nodeDimmed(n.node.id)"
            :selected="selectedSet.has(n.node.id)"
            :highlighted="flashed === n.node.id"
            @port="onPortDown"
          />
          <SpecialNode
            v-else-if="SPECIAL_KINDS.has(n.node.kind)"
            :pos="n"
            :dimmed="nodeDimmed(n.node.id)"
            :selected="selectedSet.has(n.node.id)"
            :highlighted="hoveredPairs.has(n.node.id) || flashed === n.node.id"
            @port="onPortDown"
            @goto="goTo"
          />
          <GraphNode
            v-else
            :pos="n"
            :dimmed="nodeDimmed(n.node.id)"
            :selected="selectedSet.has(n.node.id)"
            :highlighted="flashed === n.node.id"
            @port="onPortDown"
          />
        </template>

        <rect v-if="boxRect" class="select-box" v-bind="boxRect" />
        <path v-if="linkLine" class="link-drag" :d="linkLine" />
        <g v-if="pendingLink" class="link-pending">
          <path class="link-drag" :d="pendingLink.d" />
          <circle :cx="pendingLink.at.x" :cy="pendingLink.at.y" r="5" />
        </g>
      </g>
    </svg>

    <!-- Toolbar in the top right corner -->
    <div class="toolbar">
      <button type="button" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="undo()">↶</button>
      <button type="button" title="Redo (Ctrl+Y)" :disabled="!canRedo" @click="redo()">↷</button>
      <span class="toolbar-sep" />
      <button type="button" title="Zoom out" @click="zoomBy(1 / 1.25)">−</button>
      <span class="zoom">{{ zoomPercent }}</span>
      <button type="button" title="Zoom in" @click="zoomBy(1.25)">+</button>
      <button type="button" class="toolbar-text" title="Fit the whole base into the view" @click="fit">
        Fit
      </button>
      <button type="button" class="toolbar-text" title="Help: mouse and keys" @click="showHelp = !showHelp">
        ?
      </button>
    </div>

    <div v-if="showHelp" class="help" @click="showHelp = false">
      <strong>Canvas</strong>
      <div><kbd>right-click</kbd> place (factory, mine, Receiver…) / actions</div>
      <div><kbd>left drag</kbd> on empty canvas: select; on a node: move</div>
      <div><kbd>right / middle drag</kbd> or <kbd>Space + drag</kbd>: pan the view</div>
      <div><kbd>item row</kbd> click: what supplies it / what uses it; drag onto a node: link</div>
      <div>
        <kbd>Delete</kbd> delete · <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo / redo · <kbd>Ctrl+A</kbd> all
      </div>
      <div>
        <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> copy the selection with its links, paste at the mouse position
      </div>
      <div><kbd>click an edge</kbd> the link window: rails, distribution, manual rail setting</div>
    </div>

    <PortPicker v-if="picker" :key="pickerKey" :state="picker" @close="picker = null" />
    <ContextMenu v-if="menu" :menu="menu" @close="menu = null" @fit="fit" />

    <div v-if="notice" class="notice" :class="`notice--${notice.tone}`" role="status">{{ notice.text }}</div>

    <!-- Messages: loading, empty base, calculation error -->
    <div v-if="statusMessage" class="message">{{ statusMessage }}</div>

    <!-- After saving a broken data file: the graph keeps the previous data -->
    <div v-if="loadError && loadState === 'ready'" class="banner" role="alert">
      <strong>The data file is broken; the previous data is kept.</strong>
      <span>{{ loadError }}</span>
    </div>
  </div>
</template>

<script lang="ts" src="./ProductionGraph.ts"></script>
<style lang="scss" scoped src="./ProductionGraph.scss"></style>
