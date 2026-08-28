import { createRouter, createWebHistory } from "vue-router";
import ChatView from "./views/ChatView.vue";
import ModelsView from "./views/ModelsView.vue";
import SystemView from "./views/SystemView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "chat", component: ChatView },
    { path: "/models", name: "models", component: ModelsView },
    { path: "/system", name: "system", component: SystemView },
  ],
});
