export default function Page() {
  async function flipHiddenThing(formData: FormData) {
    'use server'
    void formData
  }
  return (
    <form action={flipHiddenThing}>
      <input name="hidden_thing" />
    </form>
  )
}
