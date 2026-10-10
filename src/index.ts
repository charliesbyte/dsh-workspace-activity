/**
 * Host half of the workspace-activity bundle.
 *
 * The Client module owns the rendering: it reads session status through the
 * slot's standard hooks and publishes the row rules from its own component, so
 * the Host has no service to provide and no resource to register. The empty
 * `apply` exists only to give the Loader a host-side row.
 */
export function apply(): void {}
