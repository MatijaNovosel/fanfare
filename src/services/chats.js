import { firebase } from "src/boot/firebase";
import { generateGuid, blobToFile, uploadTaskPromise, stripHtml } from "src/utils/helpers";
import { CHAT_PRIVILEGES, MSG_TYPE, GROUP_CHANGE_TYPE } from "src/utils/constants";
import { format } from "date-fns";

class ChatService {
  constructor() {
    this.chatsCollection = firebase.firestore().collection("/chats");
  }

  async getAll(userId) {
    const chatsData = await this.chatsCollection.where("userIds", "array-contains", userId).get();
    const chats = [];
    const retVal = [];

    chatsData.forEach((snapshot) => {
      chats.push({ id: snapshot.id, ...snapshot.data() });
    });

    for (let i = 0; i < chats.length; i++) {
      let lastMsg = {};

      const lastMsgData = await this.chatsCollection
        .doc(chats[i].id)
        .collection("/messages")
        .where("type", "not-in", [MSG_TYPE.INFO])
        .orderBy("type")
        .orderBy("sentAt", "desc")
        .limit(1)
        .get();

      lastMsgData.forEach((doc) => {
        const d = doc.data();
        lastMsg = {
          txt: stripHtml(d.txt),
          you: false,
          username: "Someone",
          sentAt: new Date(d.sentAt.seconds * 1000),
          type: d.type
        };
      });

      retVal.push({
        id: chats[i].id,
        createdAt: new Date(chats[i].createdAt.seconds * 1000),
        name: chats[i].name,
        avatar: chats[i].avatar,
        type: chats[i].type,
        lastMsg
      });
    }

    return retVal;
  }

  async getDetails(uid) {
    const ref = this.chatsCollection.doc(uid);
    const refGet = await ref.get();
    const data = refGet.data();
    const messages = await ref.collection("messages").orderBy("sentAt", "asc").get();
    const msgCol = [];

    messages.forEach((m) => {
      const msgData = m.data();
      msgData.sentAt = new Date(msgData.sentAt.seconds * 1000);
      msgData.id = m.id;
      msgData.chatId = uid;
      msgCol.push(msgData);
    });

    for (let i = 0; i < msgCol.length; i++) {
      if (msgCol[i].type === MSG_TYPE.FILE || msgCol[i].type === MSG_TYPE.AUDIO) {
        const file = firebase.storage().ref(msgCol[i].fileId);
        const url = await file.getDownloadURL();
        const fileInfo = await ref.collection("files").doc(msgCol[i].fileId).get();
        msgCol[i].fileUrl = url;
        msgCol[i].fileName = fileInfo.data().name;
        msgCol[i].fileSize = fileInfo.data().size;
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
    const chatFiles = chatsRef.collection("files");
    chatFiles.doc(guid).set({
      name: file.name,
      size: file.size
    });
    await uploadTaskPromise(guid, file);
    await messages.add({
      userId: userId,
      sent: true,
      type: MSG_TYPE.FILE,
      sentAt: new Date(),
      fileId: guid
    });
  }

  async sendMessage(msg) {
    const messages = this.chatsCollection.doc(msg.chatId).collection("messages");
    const data = await messages.add({
      userId: msg.userId,
      type: MSG_TYPE.TXT,
      sentAt: new Date(),
      txt: msg.txt
    });
    return data.id;
  }

  async deleteMessage(chatId, msgId) {
    const chatsRef = this.chatsCollection.doc(chatId);
    const messages = chatsRef.collection("messages");
    const doc = await messages.where(firebase.firestore.FieldPath.documentId(), "==", msgId).get();

    const fileIds = [];

    doc.forEach((doc) => {
      const data = doc.data();

      if (data.type === MSG_TYPE.FILE || data.type === MSG_TYPE.AUDIO) {
        fileIds.push(data.fileId);
      }

      doc.ref.delete();
    });

    for (let i = 0; i < fileIds.length; i++) {
      const storageRef = firebase.storage().ref(fileIds[i]);
      await storageRef.delete(storageRef);
    }
  }

  async sendAudioMessage(audioBlob, chatId, userId) {
    const guid = generateGuid();
    const chatsRef = this.chatsCollection.doc(chatId);
    const messages = chatsRef.collection("messages");
    const audioFile = blobToFile(audioBlob, `${guid}.wav`);
    const chatFiles = chatsRef.collection("files");
    chatFiles.doc(guid).set({
      name: `${guid}.wav`
    });
    await uploadTaskPromise(guid, audioFile);
    await messages.add({
      userId: userId,
      sent: true,
      type: MSG_TYPE.AUDIO,
      sentAt: new Date(),
      fileId: guid
    });
  }

  async changeGroupProfilePicture(file, groupId) {
    const guid = generateGuid();
    const retVal = await firebase.storage().ref(guid).put(file);
    const url = await retVal.ref.getDownloadURL();
    await this.chatsCollection.doc(groupId).update({
      avatar: url,
      lastChangedAt: new Date(),
      changeType: GROUP_CHANGE_TYPE.AVATAR
    });
    return url;
  }

  async sendInfoMessage(msg) {
    const messages = this.chatsCollection.doc(msg.chatId).collection("messages");
    const data = await messages.add({
      userId: msg.userId,
      type: MSG_TYPE.INFO,
      sentAt: new Date(),
      txt: msg.txt
    });
    return data.id;
  }

  async sendGroupInviteResponse(response, inviteId, user, chatId) {
    if (response) {
      const chatDetails = await this.chatsCollection.doc(chatId).get();
      const chatData = chatDetails.data();
      const users = chatData.users;
      const userIds = chatData.userIds;
      users.push({
        id: user.id,
        about: user.about,
        avatarUrl: user.avatarUrl,
        privileges: [CHAT_PRIVILEGES.ALL],
        username: user.username
      });
      userIds.push(user.id);
      await this.chatsCollection.doc(chatId).update({
        users,
        userIds
      });
      await this.sendInfoMessage({
        userId: user.id,
        type: MSG_TYPE.INFO,
        txt: `<span class="info-date">[${format(new Date(), "dd.MM.yyyy. HH:mm")}]</span> ${
          user.username
        } has joined the chat`,
        chatId
      });
    }
    await firebase
      .firestore()
      .collection("/users")
      .doc(user.id)
      .collection("/invites")
      .doc(inviteId)
      .update({
        confirmed: true
      });
  }

  async sendGroupInvite(userId, chatId, chatName) {
    await firebase
      .firestore()
      .collection("/users")
      .doc(userId)
      .collection("/invites")
      .add({
        chatId,
        txt: `You have been invited to join <b>${chatName}</b>`,
        confirmed: false
      });
  }

  async removeFromGroup(userInitiatorId, user, chatId) {
    const chatDetails = await this.chatsCollection.doc(chatId).get();
    const chatData = chatDetails.data();
    const users = chatData.users.filter((u) => u.id !== user.id);
    const userIds = chatData.userIds.filter((u) => u !== user.id);
    await this.chatsCollection.doc(chatId).update({
      users,
      userIds
    });
    await this.sendInfoMessage({
      userId: userInitiatorId,
      type: MSG_TYPE.INFO,
      txt: `<span class="info-date">[${format(new Date(), "dd.MM.yyyy. HH:mm")}]</span> ${
        user.username
      } has been removed from the chat`,
      chatId
    });
  }

  async leaveGroup(user, chatId) {
    const chatDetails = await this.chatsCollection.doc(chatId).get();
    const chatData = chatDetails.data();
    const users = chatData.users.filter((u) => u.id !== user.id);
    const userIds = chatData.userIds.filter((u) => u !== user.id);
    await this.chatsCollection.doc(chatId).update({
      users,
      userIds
    });
    await this.sendInfoMessage({
      userId: user.id,
      type: MSG_TYPE.INFO,
      txt: `<span class="info-date">[${format(new Date(), "dd.MM.yyyy. HH:mm")}]</span> ${
        user.username
      } has left the chat`,
      chatId
    });
  }

  async createGroup(invitedUsers) {
    //
  }

  async disbandGroup(initiatorUserId, chatId) {
    //
  }

  async changeGroupName(newGroupName, chatId, initiatorUserId) {
    await this.chatsCollection.doc(chatId).update({
      name: newGroupName,
      lastChangedAt: new Date(),
      changeType: GROUP_CHANGE_TYPE.NAME
    });
    await this.sendInfoMessage({
      userId: initiatorUserId,
      type: MSG_TYPE.INFO,
      txt: `<span class="info-date">[${format(
        new Date(),
        "dd.MM.yyyy. HH:mm"
      )}]</span> Group name was changed to ${newGroupName}`,
      chatId
    });
  }

  async changeGroupDescription(newGroupDescription, chatId, initiatorUserId) {
    await this.chatsCollection.doc(chatId).update({
      description: newGroupDescription,
      lastChangedAt: new Date(),
      changeType: GROUP_CHANGE_TYPE.DESCRIPTION
    });
    await this.sendInfoMessage({
      userId: initiatorUserId,
      type: MSG_TYPE.INFO,
      txt: `<span class="info-date">[${format(
        new Date(),
        "dd.MM.yyyy. HH:mm"
      )}]</span> Group description was changed to ${newGroupDescription}`,
      chatId
    });
  }
}

export default new ChatService();
