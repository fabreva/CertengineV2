// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IERC5192 {
    event Locked(uint256 tokenId);

    function locked(uint256 tokenId) external view returns (bool);
}

contract CertEngineSBT721 is ERC721, Ownable, IERC5192 {
    bytes4 private constant _EIP5192_INTERFACE_ID = 0xb45a3c0e;

    error OwnershipRenounceDisabled();
    error ZeroFamily();
    error ZeroReceiver();
    error AlreadyMinted();
    error SoulboundTransferBlocked();
    error SoulboundApprovalBlocked();
    error TokenDoesNotExist();

    event SoulboundIssued(address indexed owner, bytes32 indexed familyId, uint256 indexed tokenId);

    constructor(address initialOwner) ERC721("Cert Engine SBT", "CESBT") Ownable(initialOwner) {}

    function renounceOwnership() public pure override {
        revert OwnershipRenounceDisabled();
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == _EIP5192_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    function locked(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return true;
    }

    function mintCertified(bytes32 familyId, address receiver) external onlyOwner returns (uint256) {
        if (familyId == bytes32(0)) revert ZeroFamily();
        if (receiver == address(0)) revert ZeroReceiver();
        uint256 tokenId = uint256(familyId);
        if (_ownerOf(tokenId) != address(0)) revert AlreadyMinted();

        _mint(receiver, tokenId);
        emit Locked(tokenId);
        emit SoulboundIssued(receiver, familyId, tokenId);
        return tokenId;
    }

    function burn(uint256 tokenId) external onlyOwner {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        _burn(tokenId);
    }

    function approve(address, uint256) public pure override {
        revert SoulboundApprovalBlocked();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundApprovalBlocked();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert SoulboundTransferBlocked();
        return super._update(to, tokenId, auth);
    }
}
