import firebase from "src/boot/firebase";
import { generateGuid, getFileFromUrl } from "src/utils/helpers";
import { MSG_TYPE } from "src/utils/constants";

class ChatService {
  constructor() {
    this.chatsCollection = firebase.firestore().collection("/chats");
  }

  async getAll() {
    const chats = await this.chatsCollection.get();
    const retVal = [];
    chats.forEach((snapshot) => {
      const data = snapshot.data();
      retVal.push({
        id: snapshot.id,
        createdAt: new Date(data.createdAt.seconds * 1000),
        name: data.name,
        avatar: data.avatar,
        type: data.type,
        lastMsg: {
          txt: data.lastMsg.txt,
          you: data.lastMsg.you,
          username: data.lastMsg.username,
          sentAt: new Date(data.lastMsg.sentAt.seconds * 1000),
          type: data.lastMsg.type
        }
      });
    });
    return retVal;
  }

  async getDetails(uid) {
    const ref = this.chatsCollection.doc(uid);
    const refGet = await ref.get();
    const data = refGet.data();

    const messages = ref.collection("messages");
    const messagesGet = await messages.get();

    const files = ref.collection("files");

    const msgCol = [];

    messagesGet.forEach((m) => {
      const msgData = m.data();
      msgCol.push(msgData);
    });

    for (let i = 0; i < msgCol.length; i++) {
      if (msgCol[i].type === MSG_TYPE.FILE) {
        const file = firebase.storage().ref(msgCol[i].fileId);
        const url = await file.getDownloadURL();
        const fileData = files.doc(msgCol[i].fileId);
        const fileDataGet = await fileData.get();
        const fileContent = await getFileFromUrl(url, fileDataGet.data().name);
        msgCol[i].fileContent = fileContent;
      }
    }

    return {
      id: uid,
      createdAt: new Date(data.createdAt.seconds * 1000),
      name: data.name,
      avatar: data.avatar,
      type: data.type,
      users: data.users,
      description: data.description,
      messages: msgCol
    };
  }

  async uploadFile(file, chatId, userId) {
    const guid = generateGuid();

    const chatsRef = this.chatsCollection.doc(chatId);

    const messages = chatsRef.collection("messages");

    messages.add({
      userId: userId,
      sent: true,
      type: MSG_TYPE.FILE,
      sentAt: new Date(),
      fileId: guid
    });

    const chatFiles = chatsRef.collection("files");

    chatFiles.doc(guid).set({
      name: file.name
    });

    const storageRef = await firebase.storage().ref(guid).put(file);
  }
}

export default new ChatService();
