import type { Meta, StoryObj } from "@storybook/react-vite";

import { LoginView } from "./LoginView";

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

export const Login: Story = {}; // leaf app/login
// No leaf: the homeserver only offers a password, and the last attempt failed.
export const PasswordWithError: Story = { args: { login: { homeserver: "example.org", options: { oauth: false, password: true }, busy: false, error: "Invalid username or password." } } };
// No leaf: adding a second account, while the homeserver is looked up.
export const AddingBusy: Story = { args: { adding: true, login: { homeserver: "corp.example", busy: true } } };
