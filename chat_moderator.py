# chat_moderator.py
import requests
import sys
import json

EMAIL = "sumanyu1007@outlook.com"
GLOBAL_API_KEY = "8220b561f47586af93f4cd7d98057e8ce33b8"
ACCOUNT_ID = "4aa811f1b5d7b1557fc9c762cb1dbc2f"
MODEL = "@cf/meta/llama-3-8b-instruct"
url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL}"

# System prompt for kids chat moderation
SYSTEM_PROMPT = "You are a VERY STRICT chat moderator for a children's game (ages 6-12). Kids' safety is the top priority. Respond with ONLY 'SAFE' or 'UNSAFE'. UNSAFE if message contains: - ANY curse words or mean words (stupid, dumb, idiot, loser, etc.) - ANY mentions of violence, weapons, fighting, killing, hurting, blood - ANY body parts or bathroom words - Asking personal questions (age, name, where you live, what school) - Asking to meet, talk outside game, or exchange contact info - Mentioning social media (Discord, Snapchat, Instagram, TikTok, YouTube) - ANY adult topics (dating, relationships, inappropriate content) - Bullying, teasing, or being mean to others - Telling someone to do something dangerous - Trying to trick the filter with symbols or spacing SAFE ONLY if message is: - Positive game chat: 'good game', 'nice shot', 'great job', 'gg', 'wp' - Game strategy: 'let's go left', 'watch out', 'defend the base' - Friendly and kind: 'thanks', 'you're good', 'that was cool', 'have fun' - Simple questions about the GAME ONLY: 'how do you jump?', 'what does this do?' When in doubt, mark as UNSAFE. Better to block a safe message than allow an unsafe one."

def moderate_message(message):
    """Check if a message is safe for children's chat"""
    
    headers = {
        "X-Auth-Email": EMAIL,
        "X-Auth-Key": GLOBAL_API_KEY,
        "Content-Type": "application/json"
    }
    
    # Prepare the chat history
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Message to check: '{message}'"}
    ]
    
    payload = {"messages": messages}
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        response.raise_for_status()
        
        result = response.json()
        answer = result.get("result", {}).get("response", "No response found").strip().upper()
        
        # Parse the response
        if "SAFE" in answer and "UNSAFE" not in answer:
            return {"safe": True, "reason": "AI approved"}
        else:
            return {"safe": False, "reason": "AI blocked: potentially unsafe content"}
            
    except requests.exceptions.Timeout:
        return {"safe": False, "reason": "AI moderation timeout - blocked for safety"}
    except requests.exceptions.ConnectionError:
        return {"safe": False, "reason": "AI service unavailable - blocked for safety"}
    except Exception as e:
        return {"safe": False, "reason": f"AI error: {str(e)[:50]}"}

def main():
    """Run as standalone script for testing"""
    if len(sys.argv) > 1:
        message = " ".join(sys.argv[1:])
        result = moderate_message(message)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "No message provided"}))

if __name__ == "__main__":
    main()
