/**
 * @module main
 *
 * Application entry point: mounts the root component and loads the global stylesheet.
 * Change it only when adding an app-wide plugin (e.g. a router or a store library).
 */
import { createApp } from 'vue'

import App from './App.vue'
import './styles/main.scss'

createApp(App).mount('#app')
