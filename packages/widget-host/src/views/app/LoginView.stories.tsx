import type { Meta, StoryObj } from "@storybook/react-vite";

import { LoginView } from "./LoginView";

/** The login page: a simple fullscreen login, with the option to skip it into the DevBackend. */
const meta: Meta<typeof LoginView> = {
  title: "App/LoginView",
  component: LoginView,
  args: { login: { homeserver: "example.org", busy: false } },
  render: (args) => (
    <div style={{ height: "100vh" }}>
      <LoginView {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof LoginView>;

/** Login page (with the skip login option): you sign in on your homeserver's own page; skipping the login ends up in the DevBackend (and enables dev tools and the DevBackend). */
export const Login: Story = {};

/** The homeserver only offers a password, and the last attempt failed. */
export const PasswordWithError: Story = { args: { login: { homeserver: "example.org", options: { oauth: false, password: true }, busy: false, error: "Invalid username or password." } } };

/** Adding a second account ("Add account" of the AccountView), while the homeserver is looked up. */
export const AddingBusy: Story = { args: { adding: true, login: { homeserver: "corp.example", busy: true } } };
