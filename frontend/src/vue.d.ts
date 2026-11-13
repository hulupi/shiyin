import "vue";

declare module "vue" {
  interface ComponentCustomProperties {
    $isDesktop: boolean;
  }
}
