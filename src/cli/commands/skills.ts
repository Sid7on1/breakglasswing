import { Command, globalCommandRegistry } from './registry';
import { SkillLoader } from '../skills.loader';

globalCommandRegistry.register({
  name: '/skills',
  category: 'Configuration',
  description: 'List and manage installed JSON agent skills',
  execute: async (args, context) => {
    // Reload skills from disk
    const skills = SkillLoader.loadSkills();
    const skillKeys = Object.keys(skills);
    
    if (skillKeys.length === 0) {
      return { 
        type: 'message', 
        level: 'info',
        content: 'No dynamic skills installed. Place .json files in .breakglass/skills/ or project root skills/.' 
      };
    }
    
    return {
      type: 'menu',
      title: 'Installed Agent Skills',
      options: skillKeys.map(key => ({
        label: skills[key].name,
        value: key,
        desc: skills[key].roleDescription.substring(0, 80) + '...',
        category: 'Available Personas'
      })),
      onSelect: async (option: any) => {
        // Trigger the agent command automatically
        context.setActivePrompt({
          title: `Ask ${option.label}`,
          placeholder: 'What would you like this agent to do?',
          onResolve: (promptStr: string) => {
            if (promptStr.trim()) {
              context.addSystemMessage('success', `Booting ${option.label}...`);
              context.executeCommand(`/agent ${option.value} ${promptStr.trim()}`);
            }
          }
        });
      }
    };
  }
});
